// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'after.dart';
import 'before.dart';

part 'items.g.dart';

@JsonSerializable()
class Items {
  const Items({
    required this.actorUserId,
    required this.after,
    required this.before,
    required this.occurredAt,
    required this.policyTextVersion,
    required this.policyVersion,
    required this.reason,
    required this.seq,
  });
  
  factory Items.fromJson(Map<String, Object?> json) => _$ItemsFromJson(json);
  
  final String actorUserId;
  final After after;
  final Before before;
  final DateTime occurredAt;
  final String policyTextVersion;
  final int policyVersion;
  final String reason;
  final int seq;

  Map<String, Object?> toJson() => _$ItemsToJson(this);
}
