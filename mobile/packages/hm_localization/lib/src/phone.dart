import 'digits.dart';

/// Normalizes a Bangladesh mobile number to E.164 (`+8801XXXXXXXXX`), or null if it is not one.
/// Mirrors `normalizeBdMobile` in packages/localization; the server re-validates.
String? normalizeBdMobile(String input) {
  final digits = toLatinDigits(input).replaceAll(RegExp(r'[\s()-]'), '');
  final m = RegExp(r'^(?:\+?880|0)?(1[3-9]\d{8})$').firstMatch(digits);
  return m == null ? null : '+880${m[1]}';
}
