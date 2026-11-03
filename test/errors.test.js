import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError, ValidationError, NotFoundError, RateLimitError, UpstreamError, ConfigError } from '../src/errors.js';

test('кожен підклас має свій HTTP-статус і імʼя класу', () => {
  const cases = [
    [ValidationError, 400],
    [NotFoundError, 404],
    [RateLimitError, 429],
    [UpstreamError, 502],
  ];
  for (const [Cls, status] of cases) {
    const err = new Cls('текст');
    assert.equal(err.status, status);
    assert.equal(err.name, Cls.name);
    assert.equal(err.message, 'текст');
    assert.ok(err instanceof AppError);
    assert.ok(err instanceof Error);
  }
});

test('AppError зберігає cause, якщо її передали', () => {
  const cause = new Error('мережа');
  assert.equal(new UpstreamError('збій', { cause }).cause, cause);
});

test('ConfigError — не AppError: це помилка запуску, а не HTTP-відповіді', () => {
  const err = new ConfigError('немає ключа');
  assert.ok(err instanceof Error);
  assert.ok(!(err instanceof AppError));
  assert.equal(err.name, 'ConfigError');
});
