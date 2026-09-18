/// HMedic design system: theme and a few shared widgets.
library;

import 'package:flutter/material.dart';

class HmTheme {
  const HmTheme._();

  static const _seed = Color(0xFF0B6E4F);

  /// Bangla glyphs use the platform Noto Sans Bengali (bundled on Android; iOS falls back to its Bangla font).
  static ThemeData light() => _base(Brightness.light);
  static ThemeData dark() => _base(Brightness.dark);

  static ThemeData _base(Brightness b) => ThemeData(
    colorScheme: ColorScheme.fromSeed(seedColor: _seed, brightness: b),
    fontFamilyFallback: const ['Noto Sans Bengali', 'Noto Sans'],
    inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder()),
    useMaterial3: true,
  );
}

/// Centered, width-limited form column used by login screens.
class HmFormColumn extends StatelessWidget {
  const HmFormColumn({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Center(
    child: SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final c in children) ...[c, const SizedBox(height: 12)],
          ],
        ),
      ),
    ),
  );
}
