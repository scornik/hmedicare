// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'data13.g.dart';

@JsonSerializable()
class Data13 {
  const Data13({
    required this.accepted,
  });
  
  factory Data13.fromJson(Map<String, Object?> json) => _$Data13FromJson(json);
  
  final bool accepted;

  Map<String, Object?> toJson() => _$Data13ToJson(this);
}
