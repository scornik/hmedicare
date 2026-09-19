// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'relationship.dart';
import 'type.dart';

part 'contacts.g.dart';

@JsonSerializable()
class Contacts {
  const Contacts({
    required this.type,
    required this.value,
    this.isPreferred = false,
    this.relationship = Relationship.self,
  });
  
  factory Contacts.fromJson(Map<String, Object?> json) => _$ContactsFromJson(json);
  
  final bool isPreferred;
  final Relationship relationship;
  final Type type;
  final String value;

  Map<String, Object?> toJson() => _$ContactsToJson(this);
}
