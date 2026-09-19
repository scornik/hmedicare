// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'contacts.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Contacts _$ContactsFromJson(Map<String, dynamic> json) => Contacts(
  type: Type.fromJson(json['type'] as String),
  value: json['value'] as String,
  isPreferred: json['isPreferred'] as bool? ?? false,
  relationship: json['relationship'] == null
      ? Relationship.self
      : Relationship.fromJson(json['relationship'] as String),
);

Map<String, dynamic> _$ContactsToJson(Contacts instance) => <String, dynamic>{
  'isPreferred': instance.isPreferred,
  'relationship': instance.relationship,
  'type': instance.type,
  'value': instance.value,
};
