/*
 * cubism_bridge.mm — implementation of the pure-C ABI over the Cubism SDK.
 *
 * Mirrors the structure of the SDK's Metal sample (LAppModel/LAppPal/
 * LAppAllocator) but stripped to what the overlay needs: framework startup,
 * model load (moc + textures + physics + pose + a looping idle motion +
 * expressions + eye-blink + breath), the LAppModel update layer order, and
 * driving CubismRenderer_Metal. The sample's UIKit/scene coupling is removed —
 * files load from absolute paths and Swift owns the Metal surface.
 *
 * Step 2 adds the reaction surface the token map drives — set an expression,
 * fire a gesture motion — plus eye-blink/breath aliveness and config placement.
 *
 * Compiled with ARC disabled (see Package.swift) to match the framework's Metal
 * renderer; Metal objects are retained/released manually.
 */
#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#import <MetalKit/MetalKit.h>

#include <string>
#include <vector>

#include "cubism_bridge.h"

#include <CubismFramework.hpp>
#include <CubismDefaultParameterId.hpp>
#include <CubismModelSettingJson.hpp>
#include <ICubismModelSetting.hpp>
#include <Id/CubismIdManager.hpp>
#include <Model/CubismUserModel.hpp>
#include <Motion/CubismMotion.hpp>
#include <Motion/ACubismMotion.hpp>
#include <Effect/CubismEyeBlink.hpp>
#include <Effect/CubismBreath.hpp>
#include <Math/CubismMatrix44.hpp>
#include <Math/CubismModelMatrix.hpp>
#include <Type/csmMap.hpp>
#include <Type/csmVector.hpp>
#include <Rendering/Metal/CubismRenderer_Metal.hpp>
#include <Rendering/Metal/CubismDeviceInfo_Metal.hpp>
#include "framework/Rendering/Metal/CubismShaderInject.h"

using namespace Live2D::Cubism::Framework;
namespace Rendering = Live2D::Cubism::Framework::Rendering;
namespace DefaultParam = Live2D::Cubism::Framework::DefaultParameterId;

// ---------------------------------------------------------------------------
// Shader-source injection (consumed by the patched CubismShader_Metal).
// ---------------------------------------------------------------------------
static char *g_shaderSource = nullptr;

extern "C" void cubism_set_metal_shader_source(const char *utf8Source)
{
    if (g_shaderSource) { free(g_shaderSource); g_shaderSource = nullptr; }
    if (utf8Source) { g_shaderSource = strdup(utf8Source); }
}

extern "C" const char *CubismGetMetalShaderSource(void)
{
    return g_shaderSource;
}

// ---------------------------------------------------------------------------
// Allocator + framework startup.
// ---------------------------------------------------------------------------
class BridgeAllocator : public Csm::ICubismAllocator
{
    void *Allocate(const Csm::csmSizeType size) override { return malloc(size); }
    void Deallocate(void *memory) override { free(memory); }

    void *AllocateAligned(const Csm::csmSizeType size, const Csm::csmUint32 alignment) override
    {
        size_t offset = alignment - 1 + sizeof(void *);
        void *allocation = Allocate(size + static_cast<Csm::csmUint32>(offset));
        size_t aligned = reinterpret_cast<size_t>(allocation) + sizeof(void *);
        size_t shift = aligned % alignment;
        if (shift) { aligned += (alignment - shift); }
        void **preamble = reinterpret_cast<void **>(aligned);
        preamble[-1] = allocation;
        return reinterpret_cast<void *>(aligned);
    }

    void DeallocateAligned(void *alignedMemory) override
    {
        void **preamble = static_cast<void **>(alignedMemory);
        Deallocate(preamble[-1]);
    }
};

static BridgeAllocator g_allocator;
static Csm::CubismFramework::Option g_option;
static bool g_started = false;

static void BridgeLog(const Csm::csmChar *message)
{
    NSLog(@"[cubism] %s", message);
}

extern "C" void cubism_global_init(const void *mtlDevice)
{
    id<MTLDevice> device = (__bridge id<MTLDevice>)mtlDevice;
    if (!g_started)
    {
        g_option.LogFunction = BridgeLog;
        g_option.LoggingLevel = Csm::CubismFramework::Option::LogLevel_Warning;
        Csm::CubismFramework::StartUp(&g_allocator, &g_option);
        Csm::CubismFramework::Initialize();
        g_started = true;
    }
    // Must be called before any model's renderer is created. maskBufferCount=1
    // is the single-mask-buffer default (0 logs a warning then clamps to 1).
    Rendering::CubismRenderer_Metal::SetConstantSettings(device, 1);
}

// ---------------------------------------------------------------------------
// Small filesystem helper (absolute paths; replaces the sample's NSBundle loader).
// ---------------------------------------------------------------------------
static Csm::csmByte *LoadFileBytes(const std::string &path, Csm::csmSizeInt *outSize)
{
    NSString *p = [NSString stringWithUTF8String:path.c_str()];
    NSData *data = [NSData dataWithContentsOfFile:p];
    if (data == nil || data.length == 0)
    {
        if (outSize) { *outSize = 0; }
        return nullptr;
    }
    NSUInteger len = [data length];
    Csm::csmByte *bytes = static_cast<Csm::csmByte *>(malloc(len));
    memcpy(bytes, [data bytes], len);
    if (outSize) { *outSize = static_cast<Csm::csmSizeInt>(len); }
    return bytes;
}

static void FreeFileBytes(Csm::csmByte *bytes) { free(bytes); }

// ---------------------------------------------------------------------------
// The spike model: a minimal CubismUserModel subclass.
// ---------------------------------------------------------------------------
static const Csm::csmInt32 PriorityIdle = 1;
static const Csm::csmInt32 PriorityNormal = 2;

class BridgeModel : public Csm::CubismUserModel
{
public:
    BridgeModel() : _setting(nullptr), _scale(1.0f), _offsetX(0.0f), _offsetY(0.0f) {}

    ~BridgeModel() override
    {
        if (_setting) { delete _setting; _setting = nullptr; }
        for (id<MTLTexture> t : _textures) { [t release]; }
        _textures.clear();
        // Expressions are ACubismMotion* we own (loaded via LoadExpression).
        for (Csm::csmMap<Csm::csmString, Csm::ACubismMotion *>::const_iterator it = _expressions.Begin();
             it != _expressions.End(); ++it)
        {
            Csm::ACubismMotion::Delete(it->Second);
        }
        _expressions.Clear();
    }

    bool Load(const std::string &dir, const std::string &jsonFile,
              id<MTLDevice> device, Csm::csmUint32 viewW, Csm::csmUint32 viewH)
    {
        _dir = dir;

        Csm::csmSizeInt size;
        Csm::csmByte *buf = LoadFileBytes(dir + jsonFile, &size);
        if (!buf) { return false; }
        _setting = new Csm::CubismModelSettingJson(buf, size);
        FreeFileBytes(buf);

        if (!SetupModel()) { return false; }

        CreateRenderer(viewW, viewH);
        SetupTextures(device);
        return _model != nullptr;
    }

    void Update(Csm::csmFloat32 dt)
    {
        if (!_model) { return; }

        // LAppModel's layer order: the base motion writes into a saved/restored
        // parameter snapshot, then expression / eye-blink / breath layer
        // additively on top, then physics + pose, then the model recomputes.
        _model->LoadParameters();
        bool motionUpdated = false;
        if (_motionManager->IsFinished()) { StartIdle(); }
        else { motionUpdated = _motionManager->UpdateMotion(_model, dt); }
        _model->SaveParameters();

        // Persistent mood layer (the token map's expressions).
        if (_expressionManager) { _expressionManager->UpdateMotion(_model, dt); }

        // Eye-blink only when a motion isn't already driving the eyes, so an
        // authored gesture's eye keyframes win over the autonomous blink.
        if (!motionUpdated && _eyeBlink) { _eyeBlink->UpdateParameters(_model, dt); }

        if (_breath) { _breath->UpdateParameters(_model, dt); }
        if (_physics) { _physics->Evaluate(_model, dt); }
        if (_pose) { _pose->UpdateParameters(_model, dt); }
        _model->Update();
    }

    void Draw(id<MTLCommandBuffer> commandBuffer, MTLRenderPassDescriptor *rpd,
              Csm::csmInt32 viewW, Csm::csmInt32 viewH)
    {
        if (!_model) { return; }
        Rendering::CubismRenderer_Metal *renderer =
            GetRenderer<Rendering::CubismRenderer_Metal>();
        if (!renderer) { return; }

        // Prepare the per-device offscreen mask buffers for this frame. Without
        // this the clipping masks render as opaque white blocks over the model.
        id<MTLDevice> device = commandBuffer.device;
        Rendering::CubismDeviceInfo_Metal *info =
            Rendering::CubismDeviceInfo_Metal::GetDeviceInfo(device);
        info->GetOffscreenManager()->BeginFrameProcess();

        // The SDK sample refreshes each model's render-target size when the
        // drawable changes. Cubism 5's offscreen and mask paths use this size
        // when allocating intermediate render targets.
        SetRenderTargetSize((Csm::csmUint32)viewW, (Csm::csmUint32)viewH);

        renderer->StartFrame(commandBuffer, rpd);

        MTLViewport viewport = {0, 0, (double)viewW, (double)viewH, 0.0, 1.0};
        renderer->SetRenderViewport(viewport);

        // Aspect-correct projection: the model canvas is square; scale the longer
        // viewport axis so the square maps to a centered, undistorted region.
        Csm::CubismMatrix44 projection;
        if (viewW < viewH)
        {
            projection.Scale(1.0f, (Csm::csmFloat32)viewW / (Csm::csmFloat32)viewH);
        }
        else
        {
            projection.Scale((Csm::csmFloat32)viewH / (Csm::csmFloat32)viewW, 1.0f);
        }
        // Config placement: scale the fit, then offset in NDC (+y up). Defaults
        // (1, 0, 0) leave the centered Step-1 fit unchanged.
        projection.ScaleRelative(_scale, _scale);
        projection.TranslateRelative(_offsetX, _offsetY);
        if (_modelMatrix) { projection.MultiplyByMatrix(_modelMatrix); }

        renderer->SetMvpMatrix(&projection);
        renderer->DrawModel();
    }

    void CanvasSize(float *out2)
    {
        if (!out2) { return; }
        out2[0] = _model ? _model->GetCanvasWidth() : 1.0f;
        out2[1] = _model ? _model->GetCanvasHeight() : 1.0f;
    }

    // Start a preloaded expression by its model3.json Name. Unknown → ignored.
    void SetExpression(const std::string &name)
    {
        if (!_expressionManager) { return; }
        Csm::csmString key(name.c_str());
        if (!_expressions.IsExist(key)) { return; }
        Csm::ACubismMotion *motion = _expressions[key];
        if (motion) { _expressionManager->StartMotion(motion, false); }
    }

    // Fire a one-shot gesture from a model3.json Motions group at `index`.
    void StartMotionByGroup(const std::string &group, Csm::csmInt32 index)
    {
        if (!_setting) { return; }
        Csm::csmInt32 count = _setting->GetMotionCount(group.c_str());
        if (count == 0 || index < 0 || index >= count) { return; }

        Csm::csmSizeInt size;
        Csm::csmByte *buf = LoadFileBytes(_dir + _setting->GetMotionFileName(group.c_str(), index), &size);
        if (!buf) { return; }
        // Build a unique cache name so repeated taps don't collide.
        std::string cacheName = group + "_" + std::to_string(index);
        Csm::CubismMotion *motion = static_cast<Csm::CubismMotion *>(
            LoadMotion(buf, size, cacheName.c_str(), nullptr, nullptr, _setting, group.c_str(), index));
        FreeFileBytes(buf);
        if (motion) { _motionManager->StartMotionPriority(motion, true, PriorityNormal); }
    }

    void SetPlacement(float scale, float offsetX, float offsetY)
    {
        _scale = scale;
        _offsetX = offsetX;
        _offsetY = offsetY;
    }

private:
    bool SetupModel()
    {
        // Moc + model
        if (strcmp(_setting->GetModelFileName(), "") == 0) { return false; }
        Csm::csmSizeInt size;
        Csm::csmByte *buf = LoadFileBytes(_dir + _setting->GetModelFileName(), &size);
        if (!buf) { return false; }
        LoadModel(buf, size, false);
        FreeFileBytes(buf);
        if (!_model) { return false; }

        // Physics
        if (strcmp(_setting->GetPhysicsFileName(), "") != 0)
        {
            buf = LoadFileBytes(_dir + _setting->GetPhysicsFileName(), &size);
            if (buf) { LoadPhysics(buf, size); FreeFileBytes(buf); }
        }

        // Pose
        if (strcmp(_setting->GetPoseFileName(), "") != 0)
        {
            buf = LoadFileBytes(_dir + _setting->GetPoseFileName(), &size);
            if (buf) { LoadPose(buf, size); FreeFileBytes(buf); }
        }

        // Expressions (the persistent mood layer the token map drives).
        SetupExpressions();

        // Autonomous aliveness: blink from the model3 EyeBlink group, breath on
        // the standard angle/breath parameters (LAppModel's values).
        SetupEyeBlink();
        SetupBreath();

        // Layout
        Csm::csmMap<Csm::csmString, Csm::csmFloat32> layout;
        _setting->GetLayoutMap(layout);
        if (_modelMatrix) { _modelMatrix->SetupFromLayout(layout); }

        _model->SaveParameters();
        return true;
    }

    void SetupExpressions()
    {
        Csm::csmInt32 count = _setting->GetExpressionCount();
        for (Csm::csmInt32 i = 0; i < count; ++i)
        {
            const Csm::csmChar *name = _setting->GetExpressionName(i);
            const Csm::csmChar *file = _setting->GetExpressionFileName(i);
            if (strcmp(file, "") == 0) { continue; }

            Csm::csmSizeInt size;
            Csm::csmByte *buf = LoadFileBytes(_dir + file, &size);
            if (!buf) { continue; }
            Csm::ACubismMotion *motion = LoadExpression(buf, size, name);
            FreeFileBytes(buf);
            if (!motion) { continue; }

            Csm::csmString key(name);
            if (_expressions.IsExist(key)) { Csm::ACubismMotion::Delete(_expressions[key]); }
            _expressions[key] = motion;
        }
    }

    void SetupEyeBlink()
    {
        if (_setting->GetEyeBlinkParameterCount() > 0)
        {
            _eyeBlink = Csm::CubismEyeBlink::Create(_setting);
        }
    }

    void SetupBreath()
    {
        _breath = Csm::CubismBreath::Create();
        Csm::CubismIdManager *ids = Csm::CubismFramework::GetIdManager();
        Csm::csmVector<Csm::CubismBreath::BreathParameterData> params;
        params.PushBack(Csm::CubismBreath::BreathParameterData(ids->GetId(DefaultParam::ParamAngleX),     0.0f, 15.0f, 6.5345f, 0.5f));
        params.PushBack(Csm::CubismBreath::BreathParameterData(ids->GetId(DefaultParam::ParamAngleY),     0.0f,  8.0f, 3.5345f, 0.5f));
        params.PushBack(Csm::CubismBreath::BreathParameterData(ids->GetId(DefaultParam::ParamAngleZ),     0.0f, 10.0f, 5.5345f, 0.5f));
        params.PushBack(Csm::CubismBreath::BreathParameterData(ids->GetId(DefaultParam::ParamBodyAngleX), 0.0f,  4.0f, 15.5345f, 0.5f));
        params.PushBack(Csm::CubismBreath::BreathParameterData(ids->GetId(DefaultParam::ParamBreath),     0.5f,  0.5f, 3.2345f, 0.5f));
        _breath->SetParameters(params);
    }

    void SetupTextures(id<MTLDevice> device)
    {
        MTKTextureLoader *loader = [[MTKTextureLoader alloc] initWithDevice:device];
        NSDictionary *options = @{ MTKTextureLoaderOptionSRGB : @(NO) };

        for (Csm::csmInt32 i = 0; i < _setting->GetTextureCount(); ++i)
        {
            const Csm::csmChar *name = _setting->GetTextureFileName(i);
            if (strcmp(name, "") == 0) { continue; }
            std::string path = _dir + name;
            NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path.c_str()]];
            NSError *err = nil;
            id<MTLTexture> tex = [loader newTextureWithContentsOfURL:url options:options error:&err];
            if (!tex) { NSLog(@"[cubism] texture load failed %s: %@", path.c_str(), err); continue; }
            _textures.push_back(tex); // retained (+1 from `new...`); released in dtor
            GetRenderer<Rendering::CubismRenderer_Metal>()->BindTexture((Csm::csmUint32)i, tex);
        }
        [loader release];

        // MTKTextureLoader uploads the PNG pixels as straight alpha. The SDK
        // sample only enables premultiplied-alpha rendering when it also
        // premultiplies every pixel before upload; otherwise transparent atlas
        // padding can blend as opaque white rectangles.
        GetRenderer<Rendering::CubismRenderer_Metal>()->IsPremultipliedAlpha(false);
    }

    void StartIdle()
    {
        const Csm::csmChar *group = "Idle";
        Csm::csmInt32 count = _setting->GetMotionCount(group);
        if (count == 0) { return; }
        Csm::csmInt32 no = 0;

        Csm::csmSizeInt size;
        Csm::csmByte *buf = LoadFileBytes(_dir + _setting->GetMotionFileName(group, no), &size);
        if (!buf) { return; }
        Csm::CubismMotion *motion = static_cast<Csm::CubismMotion *>(
            LoadMotion(buf, size, "Idle_0", nullptr, nullptr, _setting, group, no));
        FreeFileBytes(buf);
        if (motion) { _motionManager->StartMotionPriority(motion, true, PriorityIdle); }
    }

    Csm::ICubismModelSetting *_setting;
    std::string _dir;
    std::vector<id<MTLTexture>> _textures;
    Csm::csmMap<Csm::csmString, Csm::ACubismMotion *> _expressions;
    Csm::csmFloat32 _scale;
    Csm::csmFloat32 _offsetX;
    Csm::csmFloat32 _offsetY;
};

// ---------------------------------------------------------------------------
// C ABI surface.
// ---------------------------------------------------------------------------
extern "C" CubismModelHandle *cubism_model_create(const char *dir, const char *modelJsonFile,
                                            const void *mtlDevice, int viewW, int viewH)
{
    id<MTLDevice> device = (__bridge id<MTLDevice>)mtlDevice;
    BridgeModel *model = new BridgeModel();
    if (!model->Load(dir, modelJsonFile, device, (Csm::csmUint32)viewW, (Csm::csmUint32)viewH))
    {
        delete model;
        return nullptr;
    }
    return reinterpret_cast<CubismModelHandle *>(model);
}

extern "C" void cubism_model_update(CubismModelHandle *model, float dtSeconds)
{
    if (model) { reinterpret_cast<BridgeModel *>(model)->Update(dtSeconds); }
}

extern "C" void cubism_model_draw(CubismModelHandle *model, const void *commandBuffer,
                                  const void *renderPassDescriptor, int viewW, int viewH)
{
    if (!model) { return; }
    id<MTLCommandBuffer> cmd = (__bridge id<MTLCommandBuffer>)commandBuffer;
    MTLRenderPassDescriptor *rpd = (__bridge MTLRenderPassDescriptor *)renderPassDescriptor;
    reinterpret_cast<BridgeModel *>(model)->Draw(cmd, rpd, viewW, viewH);
}

extern "C" void cubism_model_canvas_size(CubismModelHandle *model, float *outWidthHeight2)
{
    if (model) { reinterpret_cast<BridgeModel *>(model)->CanvasSize(outWidthHeight2); }
}

extern "C" void cubism_model_set_expression(CubismModelHandle *model, const char *name)
{
    if (model && name) { reinterpret_cast<BridgeModel *>(model)->SetExpression(name); }
}

extern "C" void cubism_model_start_motion(CubismModelHandle *model, const char *group, int index)
{
    if (model && group) { reinterpret_cast<BridgeModel *>(model)->StartMotionByGroup(group, index); }
}

extern "C" void cubism_model_set_placement(CubismModelHandle *model, float scale,
                                           float xOffset, float yOffset)
{
    if (model) { reinterpret_cast<BridgeModel *>(model)->SetPlacement(scale, xOffset, yOffset); }
}

extern "C" void cubism_model_destroy(CubismModelHandle *model)
{
    if (model) { delete reinterpret_cast<BridgeModel *>(model); }
}
