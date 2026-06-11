/*
 * spine_bridge.h — pure-C ABI over spine-cpp.
 *
 * This is the ONLY header in CSpine's public include/ dir, so it is the only
 * thing Swift's clang importer sees as `import CSpine`. The ~90 spine-cpp C++
 * headers live on a separate header-search-path (spine_include/) and never
 * cross into Swift. The bridge does all Spine work in C++ and hands Swift flat
 * mesh buffers (interleaved vertices + indices) — Swift/Metal only ever touches
 * the plain C structs below. Mirrors the project's "renderer is a dumb sink"
 * discipline: the daemon emits semantic tokens, this layer emits geometry.
 */
#ifndef SPINE_BRIDGE_H
#define SPINE_BRIDGE_H

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct SpineInstance SpineInstance;

/* One interleaved vertex: position (skeleton space), uv (0..1), unpremultiplied tint. */
typedef struct {
	float x, y;
	float u, v;
	float r, g, b, a;
} SpineVertex;

/* Matches spine::BlendMode (BlendMode.h): 0 Normal, 1 Additive, 2 Multiply, 3 Screen. */
typedef enum {
	SpineBlendNormal = 0,
	SpineBlendAdditive = 1,
	SpineBlendMultiply = 2,
	SpineBlendScreen = 3
} SpineBlend;

/* One draw batch: a vertex span + index span sharing one atlas page + blend mode.
 * Pointers reference internal storage valid only until the next
 * spine_update_and_render() call on the same instance. */
typedef struct {
	const SpineVertex *vertices;
	int32_t vertexCount;
	const uint16_t *indices;
	int32_t indexCount;
	int32_t blendMode;   /* SpineBlend */
	int32_t texturePage; /* index into the atlas pages (see spine_page_*) */
} SpineDrawCommand;

/* Load a binary skeleton (.skel) + atlas. Returns NULL on any failure
 * (missing/garbage asset, version mismatch). Never throws across the boundary. */
SpineInstance *spine_create(const char *skelPath, const char *atlasPath);
void spine_destroy(SpineInstance *inst);

/* Atlas pages — Swift loads each page's PNG (by path) into a Metal texture and
 * keys it by page index; draw commands reference the page via texturePage. */
int32_t spine_page_count(SpineInstance *inst);
const char *spine_page_path(SpineInstance *inst, int32_t index); /* texture file path as written in the .atlas */
int32_t spine_page_width(SpineInstance *inst, int32_t index);
int32_t spine_page_height(SpineInstance *inst, int32_t index);

/* True if the atlas is premultiplied-alpha (pma:true). The renderer uses this to
 * pick the texture path so both pma and straight-alpha characters composite right. */
bool spine_is_pma(SpineInstance *inst);

/* Setup-pose bounds (skeleton units) — Swift uses these to fit/center the
 * character in the window. */
void spine_get_bounds(SpineInstance *inst, float *outX, float *outY, float *outWidth, float *outHeight);

bool spine_has_animation(SpineInstance *inst, const char *name);

/* Play `name` on the base track. If loop is true it repeats. If loop is false and
 * `fallback` is non-null/non-empty, `fallback` (looping) is queued to play once
 * `name` finishes — i.e. "play once, then return to fallback". No-op if `name` is
 * an unknown animation. This is the single primitive the config-driven state model
 * (animation/loop/fallback per state) compiles down to. */
void spine_play(SpineInstance *inst, const char *name, bool loop, const char *fallback);

/* Advance the animation by deltaSeconds, recompute world transforms, and batch
 * the skeleton into draw commands. Returns the command count; *outCommands is
 * set to an internal array valid until the next call. */
int32_t spine_update_and_render(SpineInstance *inst, float deltaSeconds, const SpineDrawCommand **outCommands);

#ifdef __cplusplus
}
#endif

#endif /* SPINE_BRIDGE_H */
