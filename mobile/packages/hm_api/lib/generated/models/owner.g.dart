// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'owner.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Owner _$OwnerFromJson(Map<String, dynamic> json) => Owner(
  displayName: json['displayName'] as String,
  email: json['email'] as String?,
  phone: json['phone'] as String?,
);

Map<String, dynamic> _$OwnerToJson(Owner instance) => <String, dynamic>{
  'displayName': instance.displayName,
  'email': ?instance.email,
  'phone': ?instance.phone,
};
