import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hm_api/hm_api.dart' as api;
import 'package:hm_auth/hm_auth.dart';

/// Scripted API: records calls and answers by path.
class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.handler);

  final Future<(int, Object?)> Function(RequestOptions o) handler;
  final calls = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? body, Future<void>? cancel) async {
    calls.add(o);
    final (status, json) = await handler(o);
    return ResponseBody.fromString(
      json == null ? '' : jsonEncode(json),
      status,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

Map<String, Object?> session(String access, String refresh) => {
  'data': {
    'accessToken': access,
    'accessTokenExpiresAt': '2026-09-18T12:15:00.000Z',
    'refreshToken': refresh,
    'refreshTokenExpiresAt': '2026-10-18T12:00:00.000Z',
    'user': {
      'id': '00000000-0000-4000-8000-000000000001',
      'displayName': null,
      'email': null,
      'phoneMasked': '+88017******01',
      'emailVerified': false,
      'phoneVerified': true,
    },
  },
  'meta': {'requestId': 'rq'},
};

void main() {
  late Dio dio;
  late FakeAdapter adapter;
  late InMemoryTokenStore store;
  late HttpAuthRepository repo;
  late Future<(int, Object?)> Function(RequestOptions o) route;

  setUp(() {
    store = InMemoryTokenStore();
    dio = api.createHmDio(baseUrl: 'http://api.test');
    adapter = FakeAdapter((o) => route(o));
    dio.httpClientAdapter = adapter;
    repo = HttpAuthRepository(client: api.HmApiClient(dio), store: store, clientKind: api.ClientKind.android);
    dio.interceptors.add(AuthInterceptor(dio: dio, repository: () => repo));
  });

  test('OTP verify stores only the refresh token in secure storage and keeps access in memory', () async {
    route = (o) async => switch (o.path) {
      '/api/v1/auth/otp/request' => (
        202,
        {
          'data': {
            'challengeId': '00000000-0000-4000-8000-000000000009',
            'expiresAt': '2026-09-18T12:03:00.000Z',
            'hint': 'SENT',
          },
          'meta': {'requestId': 'rq'},
        },
      ),
      '/api/v1/auth/otp/verify' => (200, session('access-1', 'refresh-1-xxxxxxxxxxxxxxxx')),
      _ => (404, {'code': 'NOT_FOUND'}),
    };
    expect(await repo.requestOtp(phoneE164: '+8801700000001', localeTag: 'bn-BD'), OtpHint.sent);
    await repo.verifyOtp(phoneE164: '+8801700000001', code: '123456');
    expect(repo.accessToken, 'access-1');
    expect(store.token, 'refresh-1-xxxxxxxxxxxxxxxx');
    final verify = adapter.calls.last;
    expect(verify.headers['Idempotency-Key'], matches(RegExp(r'^[0-9a-f-]{36}$')));
    expect(jsonEncode(verify.data), contains('"client":"android"'));
    expect(verify.headers.containsKey('cookie'), isFalse);
  });

  test('concurrent 401s share one refresh, then retry with the new bearer', () async {
    store.token = 'refresh-0-xxxxxxxxxxxxxxxx';
    var refreshes = 0;
    final gate = Completer<void>();
    route = (o) async {
      if (o.path == '/api/v1/auth/session/refresh') {
        refreshes++;
        await gate.future;
        return (200, session('access-2', 'refresh-2-xxxxxxxxxxxxxxxx'));
      }
      if (o.path == '/api/v1/me') {
        return o.headers['authorization'] == 'Bearer access-2'
            ? (
                200,
                {
                  'data': {
                    'user': (session('a', 'b')['data'] as Map)['user'],
                    'memberships': <Object>[],
                    'platformOperator': false,
                  },
                  'meta': {'requestId': 'rq'},
                },
              )
            : (401, {'code': 'UNAUTHENTICATED'});
      }
      return (404, {'code': 'NOT_FOUND'});
    };
    final client = api.HmApiClient(dio);
    final calls = [client.me.getMe(), client.me.getMe(), client.me.getMe()];
    await Future<void>.delayed(const Duration(milliseconds: 50));
    gate.complete();
    final results = await Future.wait(calls);
    expect(results, hasLength(3));
    expect(refreshes, 1);
    expect(store.token, 'refresh-2-xxxxxxxxxxxxxxxx');
    final refreshCall = adapter.calls.firstWhere((c) => c.path.endsWith('/refresh'));
    expect(refreshCall.headers.containsKey('authorization'), isFalse);
  });

  test('refresh rejected → signed out and storage cleared; logout clears even if the server fails', () async {
    store.token = 'refresh-x-xxxxxxxxxxxxxxxx';
    route = (o) async => (401, {'code': 'SESSION_REVOKED'});
    expect(await repo.restore(), isFalse);
    expect(store.token, isNull);

    route = (o) async => o.path.endsWith('/otp/verify')
        ? (200, session('access-3', 'refresh-3-xxxxxxxxxxxxxxxx'))
        : (503, {'code': 'SERVICE_UNAVAILABLE'});
    await repo.verifyOtp(phoneE164: '+8801700000001', code: '123456');
    await repo.logout();
    expect(repo.accessToken, isNull);
    expect(store.token, isNull);
    expect(adapter.calls.last.method, 'DELETE');
  });

  test('network failure during refresh keeps the stored token for a later retry', () async {
    store.token = 'refresh-y-xxxxxxxxxxxxxxxx';
    route = (o) async => throw DioException.connectionError(requestOptions: o, reason: 'offline');
    expect(await repo.refresh(), isFalse);
    expect(store.token, 'refresh-y-xxxxxxxxxxxxxxxx');
  });

  test('idempotency keys are v4 UUIDs and unique', () {
    final keys = {for (var i = 0; i < 50; i++) newIdempotencyKey()};
    expect(keys, hasLength(50));
    expect(
      keys.first,
      matches(RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')),
    );
  });
}
