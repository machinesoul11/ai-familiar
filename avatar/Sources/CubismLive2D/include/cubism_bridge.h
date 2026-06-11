/*
 * cubism_bridge.h — pure-C ABI over the Live2D Cubism SDK for Native.
 *
 * This is the only header in CubismLive2D that Swift sees (mirrors CSpine's
 * spine_bridge.h): the C++ / Objective-C++ framework headers stay on a private
 * header-search-path so Swift's clang importer never touches them. The bridge
 * does ALL Cubism work (framework startup, model load, motion/physics update,
 * and driving the framework's own Metal renderer); Swift owns only the window,
 * the MTLDevice, and the per-frame command buffer + render pass it hands back in.
 *
 * Metal objects cross the ABI as `const void*` holding an Objective-C `id`
 * (e.g. id<MTLDevice>, id<MTLCommandBuffer>, MTLRenderPassDescriptor*). The
 * caller must keep them alive for the duration of the call.
 *
 * Step 2 grows the surface past load/update/draw with the reaction primitives
 * the token map drives — set an expression, fire a gesture motion — plus a
 * placement call for config-driven scale/offset of the projection.
 */
#ifndef cubism_bridge_h
#define cubism_bridge_h

#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct CubismModelHandle CubismModelHandle;

/*
 * Inject the MetalShaders.metal source (UTF-8) used to compile the renderer's
 * shaders at runtime (CLT has no offline metallib compiler). Call once before
 * creating any model. The string is copied; pass NULL to clear.
 */
void cubism_set_metal_shader_source(const char *utf8Source);

/* One-time framework startup + Metal device registration. Idempotent. */
void cubism_global_init(const void *mtlDevice);

/*
 * Load a model. `dir` is the model's home directory (must end with '/');
 * `modelJsonFile` is the *.model3.json filename (no directory). `viewW`/`viewH`
 * size the mask render target. Returns NULL on failure.
 */
CubismModelHandle *cubism_model_create(const char *dir, const char *modelJsonFile,
                                 const void *mtlDevice, int viewW, int viewH);

/* Advance motion + physics + pose by dtSeconds, then recompute the model. */
void cubism_model_update(CubismModelHandle *model, float dtSeconds);

/*
 * Draw into the caller's render pass. `commandBuffer` is an id<MTLCommandBuffer>;
 * `renderPassDescriptor` an MTLRenderPassDescriptor*; both as const void*.
 * viewW/viewH are the drawable size (for aspect-correct projection + viewport).
 */
void cubism_model_draw(CubismModelHandle *model, const void *commandBuffer,
                       const void *renderPassDescriptor, int viewW, int viewH);

/* Number of canvas-space units (for placement); fills a 2-float array {w,h}. */
void cubism_model_canvas_size(CubismModelHandle *model, float *outWidthHeight2);

/*
 * Start an authored expression by its model3.json `Name` (the persistent mood
 * layer — overlays additively on top of the base motion until replaced). All
 * expressions are preloaded at model-create; an unknown name is ignored.
 */
void cubism_model_set_expression(CubismModelHandle *model, const char *name);

/*
 * Fire a one-shot gesture motion. `group` is a model3.json Motions group name
 * (e.g. "TapBody"); `index` selects within the group (clamped/ignored if out of
 * range). Plays at a higher priority than the looping idle, then idle resumes.
 */
void cubism_model_start_motion(CubismModelHandle *model, const char *group, int index);

/*
 * Config-driven placement of the model in the (aspect-corrected) projection:
 * `scale` multiplies the fit, `xOffset`/`yOffset` shift it in normalized device
 * coords (+y up). Defaults (1, 0, 0) reproduce Step-1's centered fit.
 */
void cubism_model_set_placement(CubismModelHandle *model, float scale,
                                float xOffset, float yOffset);

void cubism_model_destroy(CubismModelHandle *model);

#ifdef __cplusplus
}
#endif

#endif /* cubism_bridge_h */
