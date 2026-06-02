/*
 * spine_bridge.cpp — implements the pure-C ABI (spine_bridge.h) over spine-cpp.
 * All spine:: types are confined to this file; Swift never sees them.
 */
#include "spine_bridge.h"

#include <spine/spine.h>
#include <spine/Extension.h>
#include <spine/SkeletonRenderer.h>

#include <string>
#include <vector>
#include <cstdint>

using namespace spine;

// spine-cpp requires the embedder to supply the allocator extension instance.
spine::SpineExtension *spine::getDefaultExtension() {
	return new spine::DefaultSpineExtension();
}

namespace {

struct PageInfo {
	std::string path;
	int width = 0;
	int height = 0;
};

// TextureLoader that does NO GPU work — it only records each atlas page so the
// Swift/Metal side can load the PNGs. The page's rendererObject is the page
// index, which comes back out as SpineDrawCommand.texturePage.
class RecordingTextureLoader : public TextureLoader {
public:
	std::vector<PageInfo> pages;

	void load(AtlasPage &page, const String &path) override {
		PageInfo info;
		info.path = path.buffer() ? path.buffer() : "";
		info.width = page.width;
		info.height = page.height;
		const intptr_t index = static_cast<intptr_t>(pages.size());
		pages.push_back(info);
		// Atlas.cpp copies page.texture into each region's rendererObject, which
		// SkeletonRenderer surfaces as RenderCommand.texture. We stash the page
		// index there; the Swift side keys its Metal textures by that index.
		page.texture = reinterpret_cast<void *>(index);
	}

	void unload(void * /*texture*/) override {
		// Swift owns the Metal textures; nothing to free here.
	}
};

} // namespace

struct SpineInstance {
	RecordingTextureLoader textureLoader;
	Atlas *atlas = nullptr;
	AtlasAttachmentLoader *attachmentLoader = nullptr;
	SkeletonData *skeletonData = nullptr;
	AnimationStateData *stateData = nullptr;
	Skeleton *skeleton = nullptr;
	AnimationState *state = nullptr;
	SkeletonRenderer renderer;

	// Per-frame backing storage; SpineDrawCommand pointers reference these and
	// stay valid until the next spine_update_and_render() call.
	std::vector<SpineVertex> vertices;
	std::vector<uint16_t> indices;
	std::vector<SpineDrawCommand> commands;

	~SpineInstance() {
		delete state;
		delete stateData;
		delete skeleton;
		delete skeletonData;
		delete attachmentLoader;
		delete atlas;
	}
};

SpineInstance *spine_create(const char *skelPath, const char *atlasPath) {
	if (!skelPath || !atlasPath) return nullptr;

	SpineInstance *inst = new SpineInstance();

	inst->atlas = new Atlas(String(atlasPath), &inst->textureLoader, true);
	if (inst->atlas->getPages().size() == 0) {
		delete inst;
		return nullptr;
	}

	inst->attachmentLoader = new AtlasAttachmentLoader(inst->atlas);
	SkeletonBinary binary(inst->attachmentLoader);
	inst->skeletonData = binary.readSkeletonDataFile(String(skelPath));
	if (!inst->skeletonData) {
		delete inst;
		return nullptr;
	}

	inst->stateData = new AnimationStateData(inst->skeletonData);
	inst->stateData->setDefaultMix(0.2f);

	inst->skeleton = new Skeleton(inst->skeletonData);
	inst->skeleton->setToSetupPose();
	inst->skeleton->updateWorldTransform(Physics_Update);

	inst->state = new AnimationState(inst->stateData);
	return inst;
}

void spine_destroy(SpineInstance *inst) {
	delete inst;
}

int32_t spine_page_count(SpineInstance *inst) {
	return inst ? static_cast<int32_t>(inst->textureLoader.pages.size()) : 0;
}

const char *spine_page_path(SpineInstance *inst, int32_t index) {
	if (!inst || index < 0 || index >= (int32_t) inst->textureLoader.pages.size()) return "";
	return inst->textureLoader.pages[index].path.c_str();
}

int32_t spine_page_width(SpineInstance *inst, int32_t index) {
	if (!inst || index < 0 || index >= (int32_t) inst->textureLoader.pages.size()) return 0;
	return inst->textureLoader.pages[index].width;
}

int32_t spine_page_height(SpineInstance *inst, int32_t index) {
	if (!inst || index < 0 || index >= (int32_t) inst->textureLoader.pages.size()) return 0;
	return inst->textureLoader.pages[index].height;
}

void spine_get_bounds(SpineInstance *inst, float *outX, float *outY, float *outWidth, float *outHeight) {
	if (!inst || !inst->skeletonData) return;
	if (outX) *outX = inst->skeletonData->getX();
	if (outY) *outY = inst->skeletonData->getY();
	if (outWidth) *outWidth = inst->skeletonData->getWidth();
	if (outHeight) *outHeight = inst->skeletonData->getHeight();
}

bool spine_has_animation(SpineInstance *inst, const char *name) {
	if (!inst || !inst->skeletonData || !name) return false;
	return inst->skeletonData->findAnimation(String(name)) != nullptr;
}

void spine_set_base_animation(SpineInstance *inst, const char *name, bool loop) {
	if (!inst || !inst->state || !name) return;
	if (!inst->skeletonData->findAnimation(String(name))) return;
	inst->state->setAnimation(0, String(name), loop);
}

void spine_play_oneshot(SpineInstance *inst, const char *name) {
	if (!inst || !inst->state || !name) return;
	if (!inst->skeletonData->findAnimation(String(name))) return;
	inst->state->setAnimation(1, String(name), false);
	// Mix track 1 back to nothing once the one-shot finishes, revealing track 0.
	inst->state->addEmptyAnimation(1, 0.2f, 0.0f);
}

int32_t spine_update_and_render(SpineInstance *inst, float deltaSeconds, const SpineDrawCommand **outCommands) {
	if (outCommands) *outCommands = nullptr;
	if (!inst || !inst->state || !inst->skeleton) return 0;

	inst->state->update(deltaSeconds);
	inst->state->apply(*inst->skeleton);
	inst->skeleton->update(deltaSeconds);
	inst->skeleton->updateWorldTransform(Physics_Update);

	inst->vertices.clear();
	inst->indices.clear();
	inst->commands.clear();

	struct Span {
		size_t vStart, vCount, iStart, iCount;
		int32_t blend, page;
	};
	std::vector<Span> spans;

	for (RenderCommand *cmd = inst->renderer.render(*inst->skeleton); cmd != nullptr; cmd = cmd->next) {
		Span span;
		span.vStart = inst->vertices.size();
		span.vCount = (size_t) cmd->numVertices;
		span.iStart = inst->indices.size();
		span.iCount = (size_t) cmd->numIndices;
		span.blend = (int32_t) cmd->blendMode;
		span.page = (int32_t) (intptr_t) cmd->texture;

		for (int32_t i = 0; i < cmd->numVertices; i++) {
			const uint32_t c = cmd->colors[i];
			SpineVertex v;
			v.x = cmd->positions[i * 2];
			v.y = cmd->positions[i * 2 + 1];
			v.u = cmd->uvs[i * 2];
			v.v = cmd->uvs[i * 2 + 1];
			// spine packs color as (a<<24)|(r<<16)|(g<<8)|b
			v.a = ((c >> 24) & 0xff) / 255.0f;
			v.r = ((c >> 16) & 0xff) / 255.0f;
			v.g = ((c >> 8) & 0xff) / 255.0f;
			v.b = (c & 0xff) / 255.0f;
			inst->vertices.push_back(v);
		}
		// Indices stay LOCAL (0-based within this command's vertex span).
		for (int32_t i = 0; i < cmd->numIndices; i++) {
			inst->indices.push_back(cmd->indices[i]);
		}
		spans.push_back(span);
	}

	// Finalize pointers now that the backing vectors will not grow further.
	inst->commands.reserve(spans.size());
	for (const Span &span : spans) {
		SpineDrawCommand out;
		out.vertices = span.vCount ? &inst->vertices[span.vStart] : nullptr;
		out.vertexCount = (int32_t) span.vCount;
		out.indices = span.iCount ? &inst->indices[span.iStart] : nullptr;
		out.indexCount = (int32_t) span.iCount;
		out.blendMode = span.blend;
		out.texturePage = span.page;
		inst->commands.push_back(out);
	}

	if (outCommands) *outCommands = inst->commands.data();
	return (int32_t) inst->commands.size();
}
