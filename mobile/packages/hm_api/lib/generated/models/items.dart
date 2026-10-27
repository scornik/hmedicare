// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'status3.dart';

part 'items.g.dart';

@JsonSerializable()
class Items {
  const Items({
    required this.id,
    required this.startedAt,
    required this.status,
  });
  
  factory Items.fromJson(Map<String, Object?> json) => _$ItemsFromJson(json);
  
  final String id;
  final DateTime startedAt;
  final Status3 status;

  Map<String, Object?> toJson() => _$ItemsToJson(this);
}
