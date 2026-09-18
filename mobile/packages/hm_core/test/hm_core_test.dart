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
}
