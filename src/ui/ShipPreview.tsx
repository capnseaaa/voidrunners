import { useEffect, useRef } from 'react';
import {
  ACESFilmicToneMapping, AdditiveBlending, Color, DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial, PerspectiveCamera, PMREMGenerator,
  RingGeometry, Scene, SRGBColorSpace, WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { ShipDef } from '../game/data/ships';
import { buildShipModel, type ShipModel } from '../game/render/shipModels';
import { glowTexture } from '../game/render/util';

/** Self-contained rotating 3D ship preview. Owns and disposes its own WebGL resources. */
export function ShipPreview({ ship, dim }: { ship: ShipDef; dim?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shipRef = useRef(ship);
  const swap = useRef<((s: ShipDef) => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch (err) {
      console.warn('Ship preview unavailable', err);
      return;
    }
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const scene = new Scene();
    const pmrem = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const envRT = pmrem.fromScene(room, 0.03);
    scene.environment = envRT.texture;
    pmrem.dispose();
    const camera = new PerspectiveCamera(36, 1, 0.1, 200);
    camera.position.set(0, 3.4, 12.5);
    camera.lookAt(0, 0.1, 0);
    scene.add(new HemisphereLight(0x88aaff, 0xff44aa, 1.0));
    const key = new DirectionalLight(0xffffff, 2.2);
    key.position.set(5, 8, 6);
    scene.add(key);
    const glow = glowTexture();
    const pivot = new Group();
    scene.add(pivot);
    const ringGeo = new RingGeometry(4.3, 4.5, 64);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.7, blending: AdditiveBlending });
    const ring = new Mesh(ringGeo, ringMat);
    ring.position.y = -1.5;
    const ring2 = new Mesh(ringGeo, ringMat);
    ring2.position.y = -1.5; ring2.scale.setScalar(0.72);
    scene.add(ring, ring2);

    let model: ShipModel | null = null;
    const setShip = (s: ShipDef) => {
      if (model) { pivot.remove(model.group); model.dispose(); }
      model = buildShipModel(s, glow);
      pivot.add(model.group);
      ringMat.color.copy(new Color(s.colors.glow));
    };
    setShip(shipRef.current);
    swap.current = setShip;

    const resize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.position.z = camera.aspect < 1.1 ? 15.5 : 12.5;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    let raf = 0, t = 0, last = performance.now(), alive = true;
    const loop = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now; t += dt;
      pivot.rotation.y = t * 0.6;
      pivot.position.y = Math.sin(t * 1.4) * 0.15;
      if (model) {
        model.body.rotation.z = Math.sin(t * 0.8) * 0.12;
        const fl = 1.6 + Math.sin(t * 40) * 0.15;
        for (const f of model.flames) f.scale.z = fl;
      }
      ring.rotation.y = -t * 0.3;
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      swap.current = null;
      if (model) model.dispose();
      glow.dispose(); ringGeo.dispose(); ringMat.dispose(); envRT.dispose(); room.dispose();
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    shipRef.current = ship;
    swap.current?.(ship);
  }, [ship]);

  return <canvas ref={canvasRef} style={{ filter: dim ? 'brightness(0.35) saturate(0.4)' : undefined }} />;
}
