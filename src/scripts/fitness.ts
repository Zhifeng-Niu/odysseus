#!/usr/bin/env node
/**
 * fitness CLI — RSI 适应度的独立测量入口（务必在安静机器上跑：
 * 并发的 vitest/tsc 会污染 scripted 套件的 tsc 子进程与单元套件）。
 *
 *   npx tsx src/scripts/fitness.ts
 */
import { resolve } from 'node:path';
import { measureFitness } from '../eval/fitness.js';

const cwd = resolve(process.cwd());

const report = await measureFitness(cwd);
console.log(`cwd: ${cwd}`);
console.log(`scriptedSuccessRate: ${report.scriptedSuccessRate.toFixed(2)} (15 mixed tasks, scripted provider, real orchestrator)`);
console.log(`unitPassed: ${report.unitPassed}`);
console.log(`fitness score: ${report.score.toFixed(2)} / 10`);
