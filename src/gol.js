// GOL — "Game of Life" engine.
//
// Two coupled modes on the same grid:
//  - "conway": classic Conway's Game of Life (cell alive/dead by neighbor count).
//  - "gametheory": a spatial evolutionary-game-theory AI. Each cell is an
//    economic agent running one of two strategies — Cooperate (C) or Defect (D) —
//    and plays a Prisoner's-Dilemma-style game against its 8 neighbors each tick.
//    Agents accumulate payoff and then adopt (imitate) the strategy of the
//    highest-earning agent in their neighborhood — spatial replicator / best-
//    response dynamics (Nowak & May, 1992). Defection spreads unless clustering
//    lets cooperators out-earn defectors, producing the classic evolving fronts.
//
// Payoffs use the standard economics parameterization:
//   T (temptation) > R (reward) > P (punishment) > S (sucker), with 2R > T + S.

export const STRATEGY = { DEAD: 0, COOP: 1, DEFECT: 2 };

export class GameOfLife {
  constructor(cols = 48, rows = 48) {
    this.cols = cols;
    this.rows = rows;
    this.mode = "gametheory";
    this.grid = new Uint8Array(cols * rows);
    this.payoff = new Float32Array(cols * rows);
    this.next = new Uint8Array(cols * rows);
    // Prisoner's dilemma payoff matrix (row = self, col = opponent).
    this.T = 1.6; // temptation to defect
    this.R = 1.0; // reward for mutual cooperation
    this.P = 0.1; // punishment for mutual defection
    this.S = 0.0; // sucker's payoff
    this.noise = 0.02; // strategy mutation probability
    this.generation = 0;
    this.randomize();
  }

  idx(x, y) {
    return ((y + this.rows) % this.rows) * this.cols + ((x + this.cols) % this.cols);
  }

  randomize(density = 0.5) {
    for (let i = 0; i < this.grid.length; i++) {
      if (this.mode === "conway") {
        this.grid[i] = Math.random() < density ? STRATEGY.COOP : STRATEGY.DEAD;
      } else {
        this.grid[i] = Math.random() < 0.85 ? STRATEGY.COOP : STRATEGY.DEFECT;
      }
    }
    this.generation = 0;
  }

  // Drop a cluster of defectors — perturbation to watch the AI respond.
  injectDefectors(cx, cy, r = 3) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) this.grid[this.idx(cx + dx, cy + dy)] = STRATEGY.DEFECT;
      }
    }
  }

  setMode(mode) {
    this.mode = mode;
    this.randomize();
  }

  step() {
    if (this.mode === "conway") this._stepConway();
    else this._stepGameTheory();
    this.generation++;
  }

  _stepConway() {
    const { cols, rows, grid, next } = this;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if ((dx || dy) && grid[this.idx(x + dx, y + dy)] === STRATEGY.COOP) n++;
        const alive = grid[this.idx(x, y)] === STRATEGY.COOP;
        next[this.idx(x, y)] = (alive ? n === 2 || n === 3 : n === 3) ? STRATEGY.COOP : STRATEGY.DEAD;
      }
    }
    this.grid.set(next);
  }

  _pay(self, other) {
    if (self === STRATEGY.COOP) return other === STRATEGY.COOP ? this.R : this.S;
    return other === STRATEGY.COOP ? this.T : this.P;
  }

  _stepGameTheory() {
    const { cols, rows, grid, payoff, next } = this;
    // 1) each agent plays every neighbor, accumulating payoff
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const self = grid[this.idx(x, y)];
        let total = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            if (dx || dy) total += this._pay(self, grid[this.idx(x + dx, y + dy)]);
        payoff[this.idx(x, y)] = total;
      }
    }
    // 2) each agent imitates the best-earning strategy in its neighborhood
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let best = payoff[this.idx(x, y)];
        let bestStrat = grid[this.idx(x, y)];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const p = payoff[this.idx(x + dx, y + dy)];
            if (p > best) {
              best = p;
              bestStrat = grid[this.idx(x + dx, y + dy)];
            }
          }
        }
        if (Math.random() < this.noise) bestStrat = bestStrat === STRATEGY.COOP ? STRATEGY.DEFECT : STRATEGY.COOP;
        next[this.idx(x, y)] = bestStrat;
      }
    }
    this.grid.set(next);
  }

  stats() {
    let coop = 0, defect = 0, alive = 0, payoffSum = 0;
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] === STRATEGY.COOP) { coop++; alive++; }
      else if (this.grid[i] === STRATEGY.DEFECT) { defect++; alive++; }
      payoffSum += this.payoff[i];
    }
    const active = this.mode === "conway" ? alive : coop + defect;
    return {
      generation: this.generation,
      coopRate: active ? coop / active : 0,
      defectRate: active ? defect / active : 0,
      alive,
      avgPayoff: this.grid.length ? payoffSum / this.grid.length : 0,
      // dominant "equilibrium" label for the game-theory mode
      regime: this._regime(active ? coop / active : 0),
    };
  }

  _regime(coopRate) {
    if (this.mode === "conway") return "Conway";
    if (coopRate > 0.85) return "Cooperative";
    if (coopRate < 0.15) return "Defective (Nash)";
    return "Coexistence";
  }

  // A single scalar in [0,1] the neural network can consume as a global
  // "cooperation drive" that modulates region activity.
  cooperationDrive() {
    return this.stats().coopRate;
  }
}
