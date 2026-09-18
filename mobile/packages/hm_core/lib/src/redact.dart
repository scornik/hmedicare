final _bearer = RegExp(r'Bearer\s+[A-Za-z0-9._~+/=-]+');
final _secretField = RegExp(
  r'"(accessToken|refreshToken|csrfToken|password|newPassword|code|token)"\s*:\s*"[^"]*"',
);
final _bdMobile = RegExp(r'(\+?880|0)1[3-9]\d{8}');

/// Redacts tokens, OTP codes, passwords and phone numbers before anything reaches a log (T1/T2).
String redact(String input) => input
    .replaceAll(_bearer, 'Bearer [redacted]')
    .replaceAllMapped(_secretField, (m) => '"${m[1]}":"[redacted]"')
    .replaceAllMapped(_bdMobile, (m) {
      final s = m[0]!;
      return '${s.substring(0, s.length - 8)}******${s.substring(s.length - 2)}';
    });
