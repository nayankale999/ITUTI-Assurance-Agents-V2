/* Child process used by csv.test.ts: inserts N rows into a test table. */
import { table } from '../../src/data/csv';

const t = table<{ id: string; worker: string; n: number }>({ file: 'race.csv', columns: { id: 'str', worker: 'str', n: 'int' } });
const [worker, count] = [process.argv[2], Number(process.argv[3])];
(async () => {
  await Promise.all(Array.from({ length: count }, (_, n) => t.insert({ id: `${worker}-${n}`, worker, n })));
})().catch(e => { console.error(e); process.exit(1); });
