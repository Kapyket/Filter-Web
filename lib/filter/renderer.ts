import { controls, type FilterSettings } from './settings';
const vertex = `#version 300 es
precision highp float;
out vec2 uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  uv = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const fragment = `#version 300 es
precision highp float;
uniform sampler2D source;
uniform float exposure, contrast, saturation, temperature, tint, fade, vignette;
uniform float split;
uniform bool compare;
in vec2 uv;
out vec4 color;
vec3 decodeSRGB(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 encodeSRGB(vec3 c) {
  return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}
void main() {
  vec4 inputColor = texture(source, uv);
  if (compare && uv.x < split) { color = inputColor; return; }
  vec3 c = decodeSRGB(inputColor.rgb) * exp2(exposure);
  c *= exp2(vec3(0.35 * temperature + 0.15 * tint, -0.3 * tint, -0.35 * temperature + 0.15 * tint));
  c = (c - 0.18) * contrast + 0.18;
  float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(y), c, saturation);
  c = mix(c, vec3(0.18), 0.5 * fade);
  float radius = length(uv * 2.0 - 1.0) / sqrt(2.0);
  c *= 1.0 - vignette * smoothstep(0.25, 1.0, radius);
  color = vec4(encodeSRGB(clamp(c, 0.0, 1.0)), inputColor.a);
}`;
export class FilterRenderer {
  readonly gl: WebGL2RenderingContext;
  readonly maxEdge: number;
  private program: WebGLProgram;
  private texture: WebGLTexture;
  private locations = new Map<string, WebGLUniformLocation | null>();
  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!gl)
      throw new Error(
        'WebGL2를 사용할 수 없습니다. 브라우저의 그래픽 가속을 켜고 다시 열어 주세요.',
      );
    this.gl = gl;
    const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    this.maxEdge = Math.min(
      gl.getParameter(gl.MAX_TEXTURE_SIZE),
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      viewport[0],
      viewport[1],
    );
    const shaders: WebGLShader[] = [];
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('GPU 셰이더를 만들 수 없습니다.');
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader) || '필터 컴파일 실패');
      return shader;
    };
    const program = gl.createProgram();
    const texture = gl.createTexture();
    if (!program || !texture)
      throw new Error('GPU 메모리를 할당할 수 없습니다.');
    this.program = program;
    this.texture = texture;
    try {
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error('필터 연결 실패');
    } catch (error) {
      gl.deleteProgram(program);
      gl.deleteTexture(texture);
      throw error;
    } finally {
      shaders.forEach((shader) => gl.deleteShader(shader));
    }
    gl.useProgram(program);
    for (const name of [
      ...controls.map((c) => c.key),
      'source',
      'split',
      'compare',
    ])
      this.locations.set(name, gl.getUniformLocation(program, name));
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.disable(gl.BLEND);
    gl.disable(gl.DITHER);
  }
  setSource(source: HTMLCanvasElement) {
    const gl = this.gl;
    if (source.width > this.maxEdge || source.height > this.maxEdge)
      throw new Error(
        '이미지가 GPU 처리 한도를 넘습니다. 축소 저장을 사용해 주세요.',
      );
    this.canvas.width = source.width;
    this.canvas.height = source.height;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.check();
  }
  render(settings: FilterSettings, compare = false, split = 0.5) {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform1i(this.locations.get('source')!, 0);
    for (const control of controls)
      gl.uniform1f(this.locations.get(control.key)!, settings[control.key]);
    gl.uniform1i(this.locations.get('compare')!, compare ? 1 : 0);
    gl.uniform1f(this.locations.get('split')!, split);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.check();
  }
  private check() {
    if (this.gl.isContextLost())
      throw new Error('GPU 연결이 끊겼습니다. 이미지를 다시 불러와 주세요.');
    if (this.gl.getError() !== this.gl.NO_ERROR)
      throw new Error('GPU 처리에 실패했습니다. 축소 저장을 시도해 주세요.');
  }
  dispose(releaseContext = false) {
    this.gl.deleteTexture(this.texture);
    this.gl.deleteProgram(this.program);
    if (releaseContext)
      this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
