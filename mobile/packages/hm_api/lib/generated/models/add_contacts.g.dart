// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'add_contacts.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AddContacts _$AddContactsFromJson(Map<String, dynamic> json) => AddContacts(
  type: Type.fromJson(json['type'] as String),
  value: json['value'] as String,
  isPreferred: json['isPreferred'] as bool? ?? false,
  relationship: json['relationship'] == null
      ? Relationship.self
      : Relationship.fromJson(json['relationship'] as String),
);

Map<String, dynamic> _$AddContactsToJson(AddContacts instance) =>
    <String, dynamic>{
      'isPreferred': instance.isPreferred,
      'relationship': instance.relationship,
      'type': instance.type,
      'value': instance.value,
    };
