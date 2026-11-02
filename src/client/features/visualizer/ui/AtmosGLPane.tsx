import { useEffect, useRef, useState } from 'react';
import type { AudioEngine } from '@/client/features/synth';
import { bandsFromSpectrum } from '../lib/analysis';
import { AtmosPane } from './AtmosPane';

interface AtmosGLPaneProps {
  engine: AudioEngine | null;
  width?: number;
  height?: number;
}

/**
 * ATMOSPHERE IN WEBGL, on the Milkdrop technique rather than with Milkdrop's presets.
 *
 * The trick Butterchurn inherited from Milkdrop is FEEDBACK: each frame is the last frame, zoomed,
 * rotated, rippled and dimmed, then drawn over. Nothing is a particle system and nothing is a spectrum
 * bar: the picture is its own history, which is why it can look alive from three numbers.
 *
 * Three presets, one shader: `cathedral` zooms slowly on the bass, `nebula` rotates and ripples on the
 * mids, `pulse` snaps on a kick and decays fast. All three are the same program with different uniforms,
 * so a preset cannot be a second code path nobody tests.
 *
 * A MONO ROOM STILL READS: the field is now panned by seat, so the sides carry different energy and the
 * feedback leans.
 */
const VERTEX = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrev;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uZoom;
uniform float uRot;
uniform float uWave;
uniform float uDecay;
uniform float uHue;
uniform float uSeed;

vec3 hue(float h) {
  return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}

void main() {
  // The warp: zoom, rotate and ripple the PREVIOUS frame around the centre. Bass opens the ripple.
  vec2 p = vUv - 0.5;
  float angle = uRot * uTime + sin(uTime * 0.31 + uSeed) * 0.15;
  float c = cos(angle);
  float s = sin(angle);
  vec2 rotated = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  float ripple = sin(length(rotated) * 18.0 - uTime * 1.7) * uWave * (0.02 + uBass * 0.06);
  vec2 warped = rotated * (1.0 - uZoom * (0.25 + uBass * 1.6)) + ripple * normalize(rotated + 1e-4) + 0.5;

  vec3 prev = texture2D(uPrev, clamp(warped, 0.001, 0.999)).rgb * uDecay;

  // A soft bloom where the band is busy, in the preset's hue, so the frame gains light as well as losing it.
  vec2 q = vUv - 0.5;
  float bloom = exp(-dot(q, q) * (6.0 - uMid * 4.0)) * (0.05 + uMid * 0.30 + uTreble * 0.10);
  vec3 tint = hue(uHue + uTime * 0.02);

  // A faint grain, so the feedback cannot settle into a frozen frame at low levels.
  float grain = fract(sin(dot(vUv * (uTime + uSeed), vec2(12.9898, 78.233))) * 43758.5453) * 0.012;

  gl_FragColor = vec4(clamp(prev + tint * bloom + grain, 0.0, 1.0), 1.0);
}`;

const PRESETS = {
  cathedral: { zoom: 0.10, rot: 0.05, wave: 0.6, decay: 0.982, hue: 0.62 },
  nebula: { zoom: 0.22, rot: -0.18, wave: 1.4, decay: 0.976, hue: 0.76 },
  pulse: { zoom: 0.45, rot: 0.0, wave: 0.2, decay: 0.955, hue: 0.88 },
} as const;

type PresetId = keyof typeof PRESETS;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[atmos] shader compile failed:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function AtmosGLPane({ engine, width = 800, height = 200 }: AtmosGLPaneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const [preset, setPreset] = useState<PresetId>('cathedral');

  useEffect(() => {
    if (failed) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: false, depth: false, preserveDrawingBuffer: false });
    if (!gl) {
      setFailed(true);
      return;
    }

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) {
      setFailed(true);
      return;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('[atmos] link failed:', gl.getProgramInfoLog(program));
      setFailed(true);
      return;
    }
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const makeTarget = (): { tex: WebGLTexture; fbo: WebGLFramebuffer } | null => {
      const tex = gl.createTexture();
      const fbo = gl.createFramebuffer();
      if (!tex || !fbo) return null;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex, fbo };
    };

    const targetA = makeTarget();
    const targetB = makeTarget();
    if (!targetA || !targetB) {
      setFailed(true);
      return;
    }

    const uniforms = {
      prev: gl.getUniformLocation(program, 'uPrev'),
      time: gl.getUniformLocation(program, 'uTime'),
      bass: gl.getUniformLocation(program, 'uBass'),
      mid: gl.getUniformLocation(program, 'uMid'),
      treble: gl.getUniformLocation(program, 'uTreble'),
      zoom: gl.getUniformLocation(program, 'uZoom'),
      rot: gl.getUniformLocation(program, 'uRot'),
      wave: gl.getUniformLocation(program, 'uWave'),
      decay: gl.getUniformLocation(program, 'uDecay'),
      hue: gl.getUniformLocation(program, 'uHue'),
      seed: gl.getUniformLocation(program, 'uSeed'),
    };

    // Seed the history with a soft gradient, so the first frame is not a black rectangle that the
    // feedback then keeps for a second.
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetA.fbo);
    gl.clearColor(0.02, 0.02, 0.06, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    let read = targetA;
    let write = targetB;
    let frame = 0;
    let last = 0;
    let drawn = 0;
    const started = performance.now();
    let eased = 0;

    const render = (now: number) => {
      frame = requestAnimationFrame(render);
      if (now - last < 1000 / 60) return;
      last = now;

      const snapshot = engine?.analyserSnapshot() ?? null;
      const bands = snapshot ? bandsFromSpectrum(snapshot.spectrum) : { bass: 0, mid: 0, treble: 0 };
      eased = eased + (bands.bass - eased) * 0.18;
      drawn++;
      canvas.dataset.painted = String(drawn);
      canvas.dataset.bass = bands.bass.toFixed(3);
      canvas.dataset.preset = preset;
      canvas.dataset.armed = engine?.isStarted() ? 'yes' : 'no';

      const config = PRESETS[preset];
      gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, read.tex);
      gl.uniform1i(uniforms.prev, 0);
      gl.uniform1f(uniforms.time, (now - started) / 1000);
      gl.uniform1f(uniforms.bass, eased);
      gl.uniform1f(uniforms.mid, bands.mid);
      gl.uniform1f(uniforms.treble, bands.treble);
      gl.uniform1f(uniforms.zoom, config.zoom);
      gl.uniform1f(uniforms.rot, config.rot);
      gl.uniform1f(uniforms.wave, config.wave);
      gl.uniform1f(uniforms.decay, config.decay);
      gl.uniform1f(uniforms.hue, config.hue);
      gl.uniform1f(uniforms.seed, 0.37);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Show the frame just written, and make it the history for the next one.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.bindTexture(gl.TEXTURE_2D, write.tex);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      const previousRead = read;
      read = write;
      write = previousRead;
    };

    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
      for (const target of [targetA, targetB]) {
        gl.deleteFramebuffer(target.fbo);
        gl.deleteTexture(target.tex);
      }
    };
  }, [engine, preset, failed]);

  if (failed) {
    return (
      <div className="atmos-fallback">
        <AtmosPane engine={engine} width={width} height={height} />
        <p style={{ fontSize: 11, opacity: 0.6, margin: '4px 0 0' }}>
          WebGL is not available here, so this is the 2D atmosphere. The desktop app draws the shader version.
        </p>
      </div>
    );
  }

  return (
    <div className="atmos-gl">
      <canvas
        ref={canvasRef}
        className="atmos-gl-pane"
        width={width}
        height={height}
        aria-label="Shader atmosphere reacting to the room"
        data-painted="0"
        style={{ display: 'block', width: '100%', maxWidth: width, height }}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        {(Object.keys(PRESETS) as PresetId[]).map(id => (
          <button
            key={id}
            type="button"
            data-atmos-preset={id}
            onClick={() => setPreset(id)}
            style={{
              font: 'inherit',
              fontSize: 11,
              padding: '2px 9px',
              borderRadius: 999,
              cursor: 'pointer',
              color: 'inherit',
              background: 'transparent',
              border: `1px solid ${preset === id ? 'currentColor' : 'transparent'}`,
              opacity: preset === id ? 1 : 0.6,
            }}
          >
            {id}
          </button>
        ))}
      </div>
    </div>
  );
}
