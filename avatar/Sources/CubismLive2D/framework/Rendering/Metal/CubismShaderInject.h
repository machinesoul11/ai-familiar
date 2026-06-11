/*
 * Familiar addition (NOT part of the upstream Cubism SDK).
 *
 * The Cubism Metal renderer normally loads a *prebuilt* `MetalShaders.metallib`
 * from the app bundle. That requires Apple's offline `metal`/`metallib`
 * compiler, which ships only with the full Xcode toolchain — and Familiar's
 * avatar builds under the Command Line Tools alone (same constraint that makes
 * the Spine renderer compile its shaders at runtime). To bridge that gap, the
 * Swift side injects the `MetalShaders.metal` *source* here and the patched
 * `CubismShader_Metal::GenerateShaders` compiles it with the OS runtime Metal
 * compiler (`-[MTLDevice newLibraryWithSource:...]`), which needs no Xcode.
 *
 * Returns the injected UTF-8 source, or NULL (in which case the renderer falls
 * back to the original bundle-`.metallib` path unchanged). Defined in the
 * Familiar bridge (cubism_bridge.mm), set from Swift via
 * `cubism_set_metal_shader_source()`.
 */
#ifndef CubismShaderInject_h
#define CubismShaderInject_h

#ifdef __cplusplus
extern "C" {
#endif

const char* CubismGetMetalShaderSource(void);

#ifdef __cplusplus
}
#endif

#endif /* CubismShaderInject_h */
