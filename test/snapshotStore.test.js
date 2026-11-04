// Дисковий кеш сітки: реальна тимчасова папка, мережа не потрібна.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileSnapshotStore } from '../src/services/SnapshotStore.js';
import { GridSnapshot } from '../src/domain/GridSnapshot.js';

const tempDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'wd-store-'));

test('FileSnapshotStore: збереження → читання повертає той самий знімок; немає файлу або сміття → null', async () => {
  const dir = await tempDir();
  try {
    const file = path.join(dir, 'nested', 'snap.json'); // каталогу ще нема: store створить
    const store = new FileSnapshotStore(file);
    assert.equal(await store.load(), null);

    const snapshot = new GridSnapshot({ fetchedAt: 5, startSec: 6, hours: 2, speed: [[1, 2]], dir: [[3, 4]], precip: [[0, 0.5]], temp: [[-1, null]] });
    await store.save(snapshot);
    assert.deepEqual({ ...(await store.load()) }, { ...snapshot });
    await assert.rejects(fs.access(`${file}.tmp`)); // тимчасовий файл прибрано

    await fs.writeFile(file, '{не json');
    assert.equal(await store.load(), null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('FileSnapshotStore.save: помилка запису не кидається (кеш необовʼязковий)', async () => {
  const dir = await tempDir();
  const warn = console.warn;
  console.warn = () => {};
  try {
    const blocker = path.join(dir, 'file');
    await fs.writeFile(blocker, 'x'); // «каталог» насправді файл → mkdir впаде
    const snapshot = new GridSnapshot({ fetchedAt: 1, startSec: 1, hours: 1, speed: [[1]], dir: [[1]], precip: [[1]], temp: [[1]] });
    await assert.doesNotReject(() => new FileSnapshotStore(path.join(blocker, 'snap.json')).save(snapshot));
  } finally {
    console.warn = warn;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
