import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hm_core/hm_core.dart';

void main() {
  test('redact removes bearer tokens, secrets, OTP codes and phone digits', () {
    final out = redact(
      'Authorization: Bearer abc.def.ghi {"refreshToken":"r-1","code":"123456","password":"p"} phone 01700000001',
    );
    expect(out, isNot(contains('abc.def.ghi')));
    expect(out, isNot(contains('r-1')));
    expect(out, isNot(contains('123456')));
    expect(out, isNot(contains('01700000001')));
    expect(out, contains('"code":"[redacted]"'));
  });

  test('ApiProblem keeps the stable code and retry hint', () {
    final req = RequestOptions(path: '/x');
    final p = ApiProblem.fromDio(
      DioException(
        requestOptions: req,
        response: Response(
          requestOptions: req,
          statusCode: 429,
          data: {'code': 'RATE_LIMITED', 'message': 'x', 'requestId': 'rq', 'retryAfterSeconds': 30},
        ),
      ),
    );
    expect(p.code, 'RATE_LIMITED');
    expect(p.status, 429);
    expect(p.retryAfterSeconds, 30);
    expect(
      ApiProblem.fromDio(DioException.connectionError(requestOptions: req, reason: 'down')).code,
      'NETWORK_UNAVAILABLE',
    );
  });

  test('ReadCache serves the saved copy only on network failures, marked stale', () async {
    var t = DateTime.utc(2026, 9, 19, 10);
    final cache = ReadCache(now: () => t);
    final first = await cache.readThrough('p', () async => 'v1');
    expect(first.stale, isFalse);
    expect(first.fetchedAt, DateTime.utc(2026, 9, 19, 10));

    t = t.add(const Duration(minutes: 5));
    final offline = await cache.readThrough<String>(
      'p',
      () async => throw const ApiProblem(code: 'NETWORK_UNAVAILABLE'),
    );
    expect(offline.value, 'v1');
    expect(offline.stale, isTrue);
    expect(offline.age(t), const Duration(minutes: 5));

    await expectLater(
      cache.readThrough<String>('p', () async => throw const ApiProblem(code: 'FORBIDDEN', status: 403)),
      throwsA(isA<ApiProblem>()),
      reason: 'authorization failures are never masked by a cached copy',
    );
    await expectLater(
      cache.readThrough<String>('q', () async => throw const ApiProblem(code: 'NETWORK_UNAVAILABLE')),
      throwsA(isA<ApiProblem>()),
      reason: 'no saved copy → the failure surfaces',
    );
    cache.clear();
    expect(cache.peek<String>('p'), isNull);
  });
}
