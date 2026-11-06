// Authoritative simulation state: struct-of-arrays in fixed-capacity typed arrays plus the
// fixed-order tick pipeline. No allocation per tick, no Math.random, no Date.now.
// Pipeline order and rules come from docs/PLAN.md sections 4 and 5.

import {
  GENES,
  mutateGene,
  randomGene,
  validateParams,
  type GeneName,
  type SimParams,
} from '../core/config.ts';
import { UniformGrid } from '../core/grid.ts';
import { Rng, type Seed } from '../core/rng.ts';
import { bounce, clamp, dist2, wrap } from '../core/space.ts';

export interface GeneMeans {
  radius: number;
  maxSpeed: number;
  senseRadius: number;
  metabolism: number;
  reproThreshold: number;
  seekFood: number;
  flee: number;
  wander: number;
  hue: number;
}

export interface SpeciesClass {
  radius: number;
  hue: number;
  count: number;
}

export interface WorldReport {
  tick: number;
  organisms: number;
  food: number;
  energy: number;
  meanGeneration: number;
  means: GeneMeans;
  species: SpeciesClass[];
  speciesCount: number;
  /** Every size bin, ascending by radius, including classes too small to count as a species. */
  sizeBins: SpeciesClass[];
  /** Sandbox-released organisms and their descendants alive right now. */
  engineered: number;
  engineeredMeanRadius: number;
}

const GENE_KEYS = Object.keys(GENES) as GeneName[];

export class World {
  readonly params: SimParams;
  rng: Rng;
  private readonly initialSeed: Seed;
  tick = 0;

  readonly cap: number;
  alive = 0;
  private nextLineage = 1;

  readonly x: Float64Array;
  readonly y: Float64Array;
  /** Position at the start of the current tick, for render interpolation. */
  readonly prevX: Float64Array;
  readonly prevY: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly ax: Float64Array;
  readonly ay: Float64Array;
  readonly energy: Float64Array;
  readonly age: Float64Array;
  readonly gen: Float64Array;
  readonly lineage: Int32Array;

  // One Float64Array per gene, indexed by organism slot.
  /** Exposed read-only by convention: the renderer and tests index these directly. */
  readonly gene: Record<GeneName, Float64Array>;

  readonly kill: Uint8Array;
  /** 0 = wild (seeded or born in the wild), 1 = placed by the sandbox tool.
   *  moveOrganism copies it, so every descendant of a released organism carries it: that is how an
   *  engineered lineage is counted against the wild population without walking the ancestry. */
  readonly origin: Uint8Array;

  private readonly fxAt = (i: number): number => this.fx[i];
  private readonly fyAt = (i: number): number => this.fy[i];
  /** Set per organism before a food query: the largest particle radius it can handle (gape). */
  private foodGape = 0;
  private readonly isEdible = (j: number): boolean => (this.fr[j] ?? 0) <= this.foodGape;
  private readonly orgXAt = (i: number): number => this.x[i];
  private readonly orgYAt = (i: number): number => this.y[i];

  foodCount = 0;
  readonly fx: Float64Array;
  readonly fy: Float64Array;
  /** Per-particle radius and energy: two size classes, so gape decides who can eat what. */
  readonly fr: Float64Array;
  readonly fe: Float64Array;

  private readonly orgGrid: UniformGrid;
  private readonly foodGrid: UniformGrid;

  constructor(params: SimParams, seed?: Seed) {
    validateParams(params);
    this.params = params;
    this.rng = new Rng(seed ?? params.seed);
    this.initialSeed = seed ?? params.seed;
    this.cap = params.maxOrganisms;

    this.x = new Float64Array(this.cap);
    this.y = new Float64Array(this.cap);
    this.prevX = new Float64Array(this.cap);
    this.prevY = new Float64Array(this.cap);
    this.vx = new Float64Array(this.cap);
    this.vy = new Float64Array(this.cap);
    this.ax = new Float64Array(this.cap);
    this.ay = new Float64Array(this.cap);
    this.energy = new Float64Array(this.cap);
    this.age = new Float64Array(this.cap);
    this.gen = new Float64Array(this.cap);
    this.lineage = new Int32Array(this.cap);
    this.kill = new Uint8Array(this.cap);
    this.origin = new Uint8Array(this.cap);
    this.gene = Object.fromEntries(GENE_KEYS.map((k) => [k, new Float64Array(this.cap)])) as Record<
      GeneName,
      Float64Array
    >;

    this.fx = new Float64Array(params.foodCap);
    this.fy = new Float64Array(params.foodCap);
    this.fr = new Float64Array(params.foodCap);
    this.fe = new Float64Array(params.foodCap);

    this.orgGrid = new UniformGrid(params.worldWidth, params.worldHeight, 64, this.cap);
    this.foodGrid = new UniformGrid(params.worldWidth, params.worldHeight, 32, params.foodCap);

    this.reset();
  }

  reset(): void {
    this.rng = new Rng(this.initialSeed);
    this.tick = 0;
    this.alive = 0;
    this.foodCount = 0;
    this.nextLineage = 1;
    for (let i = 0; i < this.params.startOrganisms; i++) this.spawnRandom();
    for (let i = 0; i < this.params.startFood; i++) this.spawnFood();
  }

  /** Add one organism with fully random genes. Returns its slot, or -1 when the arena is full. */
  spawnRandom(): number {
    if (this.alive >= this.cap) return -1;
    const i = this.alive++;
    for (const k of GENE_KEYS) this.gene[k][i] = randomGene(this.rng, k);
    this.placeOrganism(i);
    this.prevX[i] = this.x[i];
    this.prevY[i] = this.y[i];
    this.energy[i] = this.gene.reproThreshold[i] * 0.6;
    this.age[i] = 0;
    this.gen[i] = 0;
    this.lineage[i] = this.nextLineage++;
    this.vx[i] = 0;
    this.vy[i] = 0;
    this.kill[i] = 0;
    this.origin[i] = 0;
    return i;
  }

  /** Release one organism with an exact genome mid-run. Values outside a gene's range are clamped, so
   *  a trait editor cannot invent a creature the genetics cannot express. Returns its slot, or -1 when
   *  the arena is full. */
  engineer(x: number, y: number, genes: Partial<Record<GeneName, number>>): number {
    if (this.alive >= this.cap) return -1;
    const i = this.alive++;
    for (const k of GENE_KEYS) {
      const spec = GENES[k];
      const value = genes[k] ?? spec.def;
      this.gene[k][i] = clamp(value, spec.min, spec.max);
    }
    const r = this.gene.radius[i];
    this.x[i] = clamp(x, r, this.params.worldWidth - r);
    this.y[i] = clamp(y, r, this.params.worldHeight - r);
    this.prevX[i] = this.x[i];
    this.prevY[i] = this.y[i];
    this.energy[i] = this.gene.reproThreshold[i] * 0.6;
    this.age[i] = 0;
    this.gen[i] = 0;
    this.lineage[i] = this.nextLineage++;
    this.vx[i] = 0;
    this.vy[i] = 0;
    this.kill[i] = 0;
    this.origin[i] = 1;
    return i;
  }

  private placeOrganism(i: number): void {
    const p = this.params;
    const r = this.gene.radius[i] ?? 8;
    this.x[i] = this.rng.range(r, p.worldWidth - r);
    this.y[i] = this.rng.range(r, p.worldHeight - r);
  }

  private spawnFood(): boolean {
    if (this.foodCount >= this.params.foodCap) return false;
    const i = this.foodCount++;
    this.fx[i] = this.rng.range(0, this.params.worldWidth);
    this.fy[i] = this.rng.range(0, this.params.worldHeight);
    this.addFoodClass(i);
    return true;
  }

  /** One rng draw per particle, whatever the class, so the stream stays aligned across variants. */
  private addFoodClass(i: number, big?: boolean): void {
    const p = this.params;
    const isBig = big ?? this.rng.float() < p.bigFoodShare;
    this.fr[i] = isBig ? p.bigFoodRadius : p.foodRadius;
    this.fe[i] = isBig ? p.bigFoodEnergy : p.foodEnergy;
  }

  /** Inject food at a position (sandbox painting uses the same deterministic stream). */
  placeFood(px: number, py: number, big?: boolean): boolean {
    if (this.foodCount >= this.params.foodCap) return false;
    const i = this.foodCount++;
    this.fx[i] = clamp(px, 0, this.params.worldWidth);
    this.fy[i] = clamp(py, 0, this.params.worldHeight);
    this.addFoodClass(i, big);
    return true;
  }

  private removeFood(i: number): void {
    const last = --this.foodCount;
    this.fx[i] = this.fx[last];
    this.fy[i] = this.fy[last];
    this.fr[i] = this.fr[last];
    this.fe[i] = this.fe[last];
  }

  private killOrganism(i: number): void {
    this.kill[i] = 1;
  }

  /** Swap-remove every flagged slot. Descending order keeps moved indices below `i`. */
  private compact(): void {
    for (let i = this.alive - 1; i >= 0; i--) {
      if (!this.kill[i]) continue;
      this.kill[i] = 0;
      const last = --this.alive;
      if (i !== last) this.moveOrganism(last, i);
    }
  }

  private moveOrganism(from: number, to: number): void {
    this.x[to] = this.x[from];
    this.prevX[to] = this.prevX[from];
    this.prevY[to] = this.prevY[from];
    this.y[to] = this.y[from];
    this.vx[to] = this.vx[from];
    this.vy[to] = this.vy[from];
    this.energy[to] = this.energy[from];
    this.age[to] = this.age[from];
    this.gen[to] = this.gen[from];
    this.lineage[to] = this.lineage[from];
    this.kill[to] = this.kill[from];
    this.origin[to] = this.origin[from];
    for (const k of GENE_KEYS) this.gene[k][to] = this.gene[k][from];
  }

  report(): WorldReport {
    const means = {} as GeneMeans;
    for (const k of GENE_KEYS) means[k] = 0;
    let energy = 0;
    let gen = 0;
    let engineered = 0;
    let engineeredRadius = 0;
    for (let i = 0; i < this.alive; i++) {
      energy += this.energy[i];
      gen += this.gen[i];
      for (const k of GENE_KEYS) means[k] += this.gene[k][i];
      if (this.origin[i] === 1) {
        engineered++;
        engineeredRadius += this.gene.radius[i];
      }
    }
    const n = this.alive || 1;
    for (const k of GENE_KEYS) means[k] /= n;

    // shortcut: species are size classes (radius bins), the same axis Loeuille & Loreau structure
    // food webs on; upgrade to trait-space clustering if the graph panel needs finer taxa.
    const binWidth = this.params.speciesBinRadius;
    const bins = new Map<number, { radius: number; hue: number; count: number }>();
    for (let i = 0; i < this.alive; i++) {
      const key = Math.floor(this.gene.radius[i] / binWidth);
      let bin = bins.get(key);
      if (bin === undefined) {
        bin = { radius: 0, hue: 0, count: 0 };
        bins.set(key, bin);
      }
      bin.radius += this.gene.radius[i];
      bin.hue += this.gene.hue[i];
      bin.count += 1;
    }
    const species: SpeciesClass[] = [];
    for (const bin of bins.values()) {
      if (bin.count < this.params.speciesMinCount) continue;
      species.push({ radius: bin.radius / bin.count, hue: bin.hue / bin.count, count: bin.count });
    }
    species.sort((a, b) => b.count - a.count);

    // every size class, counted even when too small to call a species: the histogram panel needs it
    const sizeBins: SpeciesClass[] = [];
    for (const [key, bin] of bins) {
      sizeBins.push({ radius: (key + 0.5) * binWidth, hue: bin.hue / bin.count, count: bin.count });
    }
    sizeBins.sort((a, b) => a.radius - b.radius);

    return {
      tick: this.tick,
      organisms: this.alive,
      food: this.foodCount,
      energy,
      meanGeneration: gen / n,
      means,
      species,
      speciesCount: species.length,
      sizeBins,
      engineered,
      engineeredMeanRadius: engineered > 0 ? engineeredRadius / engineered : 0,
    };
  }

  /** Current slot of a lineage id, or -1. Slots move when the array compacts, so the inspector and
   *  isolate track the lineage and look the slot up again each frame. */
  slotOfLineage(lineageId: number): number {
    for (let i = 0; i < this.alive; i++) {
      if (this.lineage[i] === lineageId) return i;
    }
    return -1;
  }

  private threatSource = -1;
  private huntTarget = -1;
  private foodAcc = 0;

  private readonly isThreat = (j: number): boolean => {
    const src = this.threatSource;
    return j !== src && this.gene.radius[j] >= this.gene.radius[src] * this.params.predationRatio;
  };

  /** j is prey for huntTarget when it is meaningfully smaller but still worth handling — the
   *  size-ratio rule plus the gape floor of §5. */
  private readonly isPrey = (j: number): boolean => {
    const h = this.huntTarget;
    const rj = this.gene.radius[j];
    return (
      j !== h &&
      this.kill[j] === 0 &&
      rj >= this.params.preyMinRadius &&
      rj * this.params.predationRatio <= this.gene.radius[h]
    );
  };

  /** One tick. Order is fixed and load-bearing: think reads tick-start state, deaths are
   *  applied before children are appended, and children never act until the next tick. */
  step(): void {
    this.prevX.set(this.x.subarray(0, this.alive));
    this.prevY.set(this.y.subarray(0, this.alive));
    this.spawnFoodStep();
    this.rebuildGrids();
    this.think();
    this.integrate();
    this.eat();
    if (this.params.predationEnabled) this.predation();
    this.metabolise();
    this.compact();
    this.reproduce();
    this.reseedIfNeeded();
    this.tick++;
  }

  private spawnFoodStep(): void {
    const p = this.params;
    this.foodAcc += p.foodPerTick;
    while (this.foodAcc >= 1) {
      this.foodAcc -= 1;
      if (!this.spawnFood()) break;
    }
    // food floor keeps a grazed-empty arena from starving the whole population in one go
    if (this.foodCount < p.foodFloor) this.spawnFood();
  }

  private rebuildGrids(): void {
    this.orgGrid.clear();
    this.foodGrid.clear();
    for (let i = 0; i < this.alive; i++) this.orgGrid.insert(i, this.x[i], this.y[i]);
    for (let i = 0; i < this.foodCount; i++) this.foodGrid.insert(i, this.fx[i], this.fy[i]);
  }

  /** Sense + steer. Writes target velocity into ax/ay; integrate() applies it next tick. */
  private think(): void {
    const p = this.params;
    for (let i = 0; i < this.alive; i++) {
      const px = this.x[i];
      const py = this.y[i];
      const sr = this.gene.senseRadius[i];
      this.foodGape = Math.max(p.foodGapeMin, p.foodGapeShare * this.gene.radius[i]);
      let sx = 0;
      let sy = 0;

      const food = this.foodGrid.nearest(px, py, sr, this.fxAt, this.fyAt, this.isEdible);
      if (food >= 0) {
        const dx = this.fx[food] - px;
        const dy = this.fy[food] - py;
        const d = Math.hypot(dx, dy) || 1;
        const w = this.gene.seekFood[i];
        sx += (dx / d) * w;
        sy += (dy / d) * w;
      }

      // A smaller organism counts as food, so hunting reuses the seekFood weight instead of a new
      // gene: chase whichever edible thing is nearer.
      if (p.predationEnabled && this.gene.radius[i] >= p.predatorMinRadius) {
        this.huntTarget = i;
        const prey = this.orgGrid.nearest(px, py, sr, this.orgXAt, this.orgYAt, this.isPrey);
        if (prey >= 0) {
          const pdx = this.x[prey] - px;
          const pdy = this.y[prey] - py;
          const pd = Math.hypot(pdx, pdy);
          const foodGap = food >= 0 ? Math.hypot(this.fx[food] - px, this.fy[food] - py) : Infinity;
          if (pd < foodGap) {
            const w = this.gene.seekFood[i];
            const d = pd || 1;
            sx = (pdx / d) * w;
            sy = (pdy / d) * w;
          }
        }
      }

      const fw = this.gene.flee[i];
      if (fw > 0) {
        this.threatSource = i;
        const threat = this.orgGrid.nearest(px, py, sr, this.orgXAt, this.orgYAt, this.isThreat);
        if (threat >= 0) {
          const dx = this.x[threat] - px;
          const dy = this.y[threat] - py;
          const d = Math.hypot(dx, dy) || 1;
          sx -= (dx / d) * fw;
          sy -= (dy / d) * fw;
        }
      }

      const ww = this.gene.wander[i];
      if (ww > 0) {
        const a = this.rng.float() * Math.PI * 2;
        sx += Math.cos(a) * ww;
        sy += Math.sin(a) * ww;
      }

      const mag = Math.hypot(sx, sy);
      if (mag > 1) {
        sx /= mag;
        sy /= mag;
      }
      const speedEff =
        this.gene.maxSpeed[i] / (1 + p.speedPenalty * (this.gene.radius[i] - GENES.radius.min));
      this.ax[i] = sx * speedEff;
      this.ay[i] = sy * speedEff;
    }
  }

  private integrate(): void {
    const p = this.params;
    const lerp = Math.min(1, p.accel * p.dt);
    for (let i = 0; i < this.alive; i++) {
      this.vx[i] += (this.ax[i] - this.vx[i]) * lerp;
      this.vy[i] += (this.ay[i] - this.vy[i]) * lerp;
      const r = this.gene.radius[i];
      let nx = this.x[i] + this.vx[i] * p.dt;
      let ny = this.y[i] + this.vy[i] * p.dt;
      if (p.wallMode === 'bounce') {
        if (nx < r || nx > p.worldWidth - r) {
          this.vx[i] = -this.vx[i];
          nx = bounce(nx, p.worldWidth, r);
        }
        if (ny < r || ny > p.worldHeight - r) {
          this.vy[i] = -this.vy[i];
          ny = bounce(ny, p.worldHeight, r);
        }
      } else {
        nx = wrap(nx, p.worldWidth);
        ny = wrap(ny, p.worldHeight);
      }
      this.x[i] = clamp(nx, 0, p.worldWidth);
      this.y[i] = clamp(ny, 0, p.worldHeight);
      this.age[i] += 1;
    }
  }

  private eat(): void {
    const p = this.params;
    for (let i = 0; i < this.alive; i++) {
      const r = this.gene.radius[i];
      this.foodGape = Math.max(p.foodGapeMin, p.foodGapeShare * r);
      // reach spans the largest particle class; isEdible is what keeps a small organism off a big one
      const reach = r + p.bigFoodRadius;
      // shortcut: food cells go stale after a swap-remove within the same tick; the distance
      // check in nearest() still holds, so a particle is only ever missed, never double eaten.
      const f = this.foodGrid.nearest(this.x[i], this.y[i], reach, this.fxAt, this.fyAt, this.isEdible);
      if (f < 0) continue;
      // a particle too small to be worth handling for this organism still gets eaten, for almost nothing
      const crumbs = (this.fr[f] ?? 0) < p.foodMinShare * r ? p.foodSmallPenalty : 1;
      this.energy[i] += (this.fe[f] ?? p.foodEnergy) * crumbs;
      const cap = this.gene.reproThreshold[i] * 2;
      if (this.energy[i] > cap) this.energy[i] = cap;
      this.removeFood(f);
    }
  }

  /** Maintenance + sensing + locomotion. This cost table is what makes traits cost fitness. */
  private metabolise(): void {
    const p = this.params;
    for (let i = 0; i < this.alive; i++) {
      const r = this.gene.radius[i];
      const mass = r * r;
      const speed2 = this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i];
      const sr = this.gene.senseRadius[i];
      const upkeep = p.baseMeta + p.metaK * Math.pow(mass, p.metaExp) + p.senseCostK * sr * sr;
      const cost = p.dt * (this.gene.metabolism[i] * upkeep + p.moveK * speed2 * Math.sqrt(mass));
      this.energy[i] -= cost;
      if (this.energy[i] <= 0) this.killOrganism(i);
    }
  }

  /** Size-structured predation (PLAN §5): overlap plus a radius ratio, with a juvenile refuge for
   *  hunters under preyMinRadius. One kill per hunter per tick, so a big organism cannot clear the
   *  arena in a single tick. */
  private predation(): void {
    const p = this.params;
    for (let i = 0; i < this.alive; i++) {
      if (this.kill[i] !== 0) continue;
      const r = this.gene.radius[i];
      if (r < p.predatorMinRadius) continue;
      this.huntTarget = i;
      // overlap needs the pair within sum of radii, and no organism is bigger than GENES.radius.max
      const prey = this.orgGrid.nearest(this.x[i], this.y[i], r + GENES.radius.max, this.orgXAt, this.orgYAt, this.isPrey);
      if (prey < 0) continue;
      const gap = r + this.gene.radius[prey];
      const dx = this.x[prey] - this.x[i];
      const dy = this.y[prey] - this.y[i];
      if (dx * dx + dy * dy > gap * gap) continue;
      this.energy[i] += p.preyEnergyFraction * this.energy[prey];
      const cap = this.gene.reproThreshold[i] * 2;
      if (this.energy[i] > cap) this.energy[i] = cap;
      this.kill[prey] = 1;
    }
  }

  private reproduce(): void {
    const p = this.params;
    const n = this.alive; // children added now act from the next tick on
    for (let i = 0; i < n; i++) {
      if (this.alive >= this.cap) break;
      if (this.age[i] < p.minAgeTicks) continue;
      const thr = this.gene.reproThreshold[i];
      if (this.energy[i] < thr) continue;
      const cost = p.reproShareParent * thr;
      this.energy[i] -= cost;

      const child = this.alive++;
      this.moveOrganism(i, child);
      for (const k of GENE_KEYS) this.gene[k][child] = mutateGene(this.rng, k, this.gene[k][i], p);
      this.energy[child] = cost * p.reproShareChild;
      this.age[child] = 0;
      this.gen[child] = this.gen[i] + 1;
      this.kill[child] = 0;

      const a = this.rng.float() * Math.PI * 2;
      const sep = this.gene.radius[i] + this.gene.radius[child];
      this.x[child] = clamp(this.x[i] + Math.cos(a) * sep, 0, p.worldWidth);
      this.y[child] = clamp(this.y[i] + Math.sin(a) * sep, 0, p.worldHeight);
      this.prevX[child] = this.x[child];
      this.prevY[child] = this.y[child];
    }
  }

  private reseedIfNeeded(): void {
    if (this.alive > 0 || !this.params.reseedOnEmpty) return;
    for (let i = 0; i < this.params.startOrganisms; i++) this.spawnRandom();
  }

  /** FNV-1a over the canonical numeric state. Same seed + params + ticks => same hash. */
  stateHash(): number {
    let h = 0x811c9dc5;
    const push = (value: number): void => {
      const bits = Number.isFinite(value) ? Math.trunc(value * 1e6) : 0x7fffffff;
      h = Math.imul(h ^ (bits & 0xff), 0x01000193);
      h = Math.imul(h ^ ((bits >>> 8) & 0xff), 0x01000193);
      h = Math.imul(h ^ ((bits >>> 16) & 0xff), 0x01000193);
      h = Math.imul(h ^ ((bits >>> 24) & 0xff), 0x01000193);
    };
    push(this.tick);
    push(this.alive);
    push(this.foodCount);
    push(this.nextLineage);
    for (const arr of [this.x, this.y, this.vx, this.vy, this.energy, this.age, this.gen]) {
      for (let i = 0; i < this.alive; i++) push(arr[i]);
    }
    for (const k of GENE_KEYS) {
      const arr = this.gene[k];
      for (let i = 0; i < this.alive; i++) push(arr[i]);
    }
    for (let i = 0; i < this.alive; i++) push(this.lineage[i]);
    for (let i = 0; i < this.foodCount; i++) {
      push(this.fx[i]);
      push(this.fy[i]);
    }
    return h >>> 0;
  }
}
