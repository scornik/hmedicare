const _bn = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

/// Latin digits → Bangla digits (display only; the API always uses Latin digits).
String toBanglaDigits(String s) => s.replaceAllMapped(RegExp(r'\d'), (m) => _bn[int.parse(m[0]!)]);

/// Bangla digits → Latin digits (normalizes user input before sending it to the API).
String toLatinDigits(String s) {
  final b = StringBuffer();
  for (final r in s.runes) {
    final i = _bn.indexOf(String.fromCharCode(r));
    b.write(i >= 0 ? '$i' : String.fromCharCode(r));
  }
  return b.toString();
}
