// Pooled GPU point particles and instanced debris chunks. Both use fixed-size
// typed arrays so nothing is allocated while the game is running.
import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, InstancedMesh, Matrix4, MeshStandardMaterial, Points, Quaternion,
  ShaderMaterial, TetrahedronGeometry, Vector3, Euler,
} from 'three';

export class ParticleSystem {
  readonly points: Points;
  private readonly n: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly drag: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private cursor = 0;
  private readonly geo: BufferGeometry;
  private readonly mat: ShaderMaterial;

  constructor(capacity: number) {
    this.n = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.geo = new BufferGeometry();
    const mk = (arr: Float32Array, item: number) => { const a = new BufferAttribute(arr, item); a.setUsage(DynamicDrawUsage); return a; };
    this.geo.setAttribute('position', mk(this.pos, 3));
    this.geo.setAttribute('aColor', mk(this.col, 3));
    this.geo.setAttribute('aSize', mk(this.size, 1));
    this.geo.setAttribute('aAlpha', mk(this.alpha, 1));
    this.mat = new ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      vertexShader: `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        uniform float uScale; varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = aColor; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(256.0, aSize * uScale / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, d);
          gl_FragColor = vec4(vColor * a * a * vAlpha, 1.0);
        }`,
      blending: AdditiveBlending, depthWrite: false, transparent: true,
    });
    this.points = new Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  setViewport(height: number, fovDeg: number): void {
    this.mat.uniforms.uScale.value = height / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, r: number, g: number, b: number, size: number, sizeEnd: number, life: number, drag = 0): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    const j = i * 3;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.col[j] = r; this.col[j + 1] = g; this.col[j + 2] = b;
    this.size0[i] = size; this.size1[i] = sizeEnd; this.size[i] = size;
    this.life[i] = life; this.maxLife[i] = life; this.drag[i] = drag; this.alpha[i] = 1;
  }

  update(dt: number): void {
    const { pos, vel, life, maxLife, size, size0, size1, alpha, drag } = this;
    for (let i = 0; i < this.n; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) { size[i] = 0; alpha[i] = 0; continue; }
      const j = i * 3;
      const k = 1 - Math.min(1, drag[i] * dt);
      vel[j] *= k; vel[j + 1] *= k; vel[j + 2] *= k;
      pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
      const t = life[i] / maxLife[i];
      size[i] = size1[i] + (size0[i] - size1[i]) * t;
      alpha[i] = t < 0.5 ? t * 2 : 1;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }

  dispose(): void { this.geo.dispose(); this.mat.dispose(); }
}

const m4 = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const p3 = new Vector3();
const s3 = new Vector3();
const c = new Color();

/** Tumbling chunks thrown out by explosions. */
export class DebrisSystem {
  readonly mesh: InstancedMesh;
  private readonly n: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly scale: Float32Array;
  private readonly heat: Float32Array; // base colour as rgb
  private cursor = 0;

  constructor(capacity: number) {
    this.n = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.rot = new Float32Array(capacity * 3);
    this.spin = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.scale = new Float32Array(capacity);
    this.heat = new Float32Array(capacity * 3);
    const geo = new TetrahedronGeometry(1, 0);
    geo.scale(1, 0.45, 1.5);
    const mat = new MeshStandardMaterial({ color: 0xffffff, metalness: 0.6, roughness: 0.5 });
    this.mesh = new InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    m4.makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) { this.mesh.setMatrixAt(i, m4); this.mesh.setColorAt(i, c.set(0x333333)); }
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, scale: number, life: number, color: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    const j = i * 3;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.rot[j] = Math.random() * 6; this.rot[j + 1] = Math.random() * 6; this.rot[j + 2] = Math.random() * 6;
    this.spin[j] = (Math.random() - 0.5) * 12; this.spin[j + 1] = (Math.random() - 0.5) * 12; this.spin[j + 2] = (Math.random() - 0.5) * 12;
    this.life[i] = life; this.maxLife[i] = life; this.scale[i] = scale;
    c.set(color);
    this.heat[j] = c.r; this.heat[j + 1] = c.g; this.heat[j + 2] = c.b;
  }

  /** Radial burst of chunks inheriting a base velocity. */
  burst(x: number, y: number, z: number, count: number, speed: number, scale: number, life: number, color: number, bvx = 0, bvy = 0, bvz = 0): void {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * 6.283, u = Math.random() * 2 - 1, r = Math.sqrt(1 - u * u);
      const sp = speed * (0.35 + Math.random() * 0.85);
      this.emit(x, y, z, bvx + Math.cos(a) * r * sp, bvy + u * sp * 0.7 + speed * 0.15, bvz + Math.sin(a) * r * sp, scale * (0.4 + Math.random()), life * (0.6 + Math.random() * 0.7), color);
    }
  }

  update(dt: number): void {
    const { pos, vel, rot, spin, life, maxLife, scale, heat } = this;
    let dirty = false;
    for (let i = 0; i < this.n; i++) {
      if (life[i] <= 0) continue;
      dirty = true;
      life[i] -= dt;
      const j = i * 3;
      if (life[i] <= 0) { m4.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, m4); continue; }
      const k = 1 - Math.min(1, 0.6 * dt);
      vel[j] *= k; vel[j + 1] = vel[j + 1] * k - 9 * dt; vel[j + 2] *= k;
      pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
      rot[j] += spin[j] * dt; rot[j + 1] += spin[j + 1] * dt; rot[j + 2] += spin[j + 2] * dt;
      const t = life[i] / maxLife[i];
      const sc = scale[i] * Math.min(1, t * 3);
      m4.compose(p3.set(pos[j], pos[j + 1], pos[j + 2]), q.setFromEuler(e.set(rot[j], rot[j + 1], rot[j + 2])), s3.set(sc, sc, sc));
      this.mesh.setMatrixAt(i, m4);
      // chunks start glowing hot and cool to dark metal
      const hot = Math.max(0, t * 2 - 1);
      c.setRGB(0.12 + heat[j] * 0.25 + hot * 3 * heat[j], 0.12 + heat[j + 1] * 0.25 + hot * 2 * heat[j + 1], 0.13 + heat[j + 2] * 0.25 + hot * heat[j + 2]);
      this.mesh.setColorAt(i, c);
    }
    if (dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void { this.mesh.geometry.dispose(); (this.mesh.material as MeshStandardMaterial).dispose(); }
}
