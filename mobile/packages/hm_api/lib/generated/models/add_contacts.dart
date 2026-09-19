// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

import 'relationship.dart';
import 'type.dart';

part 'add_contacts.g.dart';

@JsonSerializable()
class AddContacts {
  const AddContacts({
    required this.type,
    required this.value,
    this.isPreferred = false,
    this.relationship = Relationship.self,
  });
  
  factory AddContacts.fromJson(Map<String, Object?> json) => _$AddContactsFromJson(json);
  
  final bool isPreferred;
  final Relationship relationship;
  final Type type;
  final String value;

  Map<String, Object?> toJson() => _$AddContactsToJson(this);
}
