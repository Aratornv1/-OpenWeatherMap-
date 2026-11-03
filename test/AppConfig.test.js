import test from 'node:test';
import assert from 'node:assert/strict';
import { AppConfig } from '../src/AppConfig.js';
import { ConfigError } from '../src/errors.js';

test('fromEnv: читає ключ і порт, публічна папка підставляється', () => {
  const config = AppConfig.fromEnv({ OPENWEATHER_API_KEY: 'abc', PORT: '4000' }, '/pub');
  assert.equal(config.apiKey, 'abc');
  assert.equal(config.port, 4000);
  assert.equal(config.publicDir, '/pub');
});

test('fromEnv: без PORT — 3000', () => {
  assert.equal(AppConfig.fromEnv({ OPENWEATHER_API_KEY: 'abc' }).port, 3000);
});

test('fromEnv: немає ключа або заглушка з .env.example → ConfigError', () => {
  assert.throws(() => AppConfig.fromEnv({}), ConfigError);
  assert.throws(() => AppConfig.fromEnv({ OPENWEATHER_API_KEY: '' }), ConfigError);
  assert.throws(() => AppConfig.fromEnv({ OPENWEATHER_API_KEY: AppConfig.PLACEHOLDER_KEY }), ConfigError);
});
