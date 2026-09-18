// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint, unused_import, invalid_annotation_target, unnecessary_import

import 'package:json_annotation/json_annotation.dart';

part 'me_user.g.dart';

@JsonSerializable()
class MeUser {
  const MeUser({
    required this.displayName,
    required this.email,
    required this.emailVerified,
    required this.id,
    required this.phoneMasked,
    required this.phoneVerified,
  });
  
  factory MeUser.fromJson(Map<String, Object?> json) => _$MeUserFromJson(json);
  
  final String? displayName;
  final String? email;
  final bool emailVerified;
  final String id;
  final String? phoneMasked;
  final bool phoneVerified;

  Map<String, Object?> toJson() => _$MeUserToJson(this);
}
