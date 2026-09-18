import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hm_localization/hm_localization.dart';

void main() {
  test('bn and en string tables have identical keys', () {
    expect(HmStrings.all['en']!.keys.toSet(), HmStrings.all['bn']!.keys.toSet());
    expect(HmStrings.forLocale(const Locale('en', 'BD')).t('signIn'), 'Sign in');
  });

  test('digits convert both ways', () {
    expect(toBanglaDigits('01700 12'), '০১৭০০ ১২');
    expect(toLatinDigits('০১৭০০০০০০০১'), '01700000001');
  });

  test('normalizeBdMobile accepts local, +880 and Bangla-digit forms only', () {
    expect(normalizeBdMobile('01700000001'), '+8801700000001');
    expect(normalizeBdMobile('+880 1700-000001'), '+8801700000001');
    expect(normalizeBdMobile('০১৭০০০০০০০১'), '+8801700000001');
    expect(normalizeBdMobile('01200000001'), isNull);
    expect(normalizeBdMobile('12345'), isNull);
  });

  test('apiLocaleTag', () => expect(apiLocaleTag(bnBD), 'bn-BD'));
}
