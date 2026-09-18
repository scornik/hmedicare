import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

const bnBD = Locale('bn', 'BD');
const enBD = Locale('en', 'BD');
const supportedLocales = [bnBD, enBD];

/// Current UI locale; Bangla by default.
class LocaleController extends Notifier<Locale> {
  @override
  Locale build() => bnBD;

  void toggle() => state = state == bnBD ? enBD : bnBD;
}

final localeProvider = NotifierProvider<LocaleController, Locale>(LocaleController.new);

/// API locale tag for the current UI locale (`bn-BD` / `en-BD`).
String apiLocaleTag(Locale l) => '${l.languageCode}-${l.countryCode ?? 'BD'}';
