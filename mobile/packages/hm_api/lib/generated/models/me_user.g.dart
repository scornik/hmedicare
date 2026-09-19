// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'me_user.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

MeUser _$MeUserFromJson(Map<String, dynamic> json) => MeUser(
  displayName: json['displayName'] as String?,
  email: json['email'] as String?,
  emailVerified: json['emailVerified'] as bool,
  id: json['id'] as String,
  phoneMasked: json['phoneMasked'] as String?,
  phoneVerified: json['phoneVerified'] as bool,
);

Map<String, dynamic> _$MeUserToJson(MeUser instance) => <String, dynamic>{
  'displayName': ?instance.displayName,
  'email': ?instance.email,
  'emailVerified': instance.emailVerified,
  'id': instance.id,
  'phoneMasked': ?instance.phoneMasked,
  'phoneVerified': instance.phoneVerified,
};
