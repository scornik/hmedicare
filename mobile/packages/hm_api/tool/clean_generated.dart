import 'dart:io';

/// Removes the previous swagger_parser output so deleted schemas never linger (CI diff check).
void main() {
  final dir = Directory('lib/generated');
  if (dir.existsSync()) dir.deleteSync(recursive: true);
}
