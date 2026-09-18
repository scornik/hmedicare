import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:hm_auth/hm_auth.dart';
import 'package:hm_design/hm_design.dart';
import 'package:hm_localization/hm_localization.dart';

/// Staff/doctor sign-in with email + password (bearer transport, refresh token in secure storage).
class DoctorLoginScreen extends ConsumerStatefulWidget {
  const DoctorLoginScreen({super.key});

  @override
  ConsumerState<DoctorLoginScreen> createState() => _DoctorLoginScreenState();
}

class _DoctorLoginScreenState extends ConsumerState<DoctorLoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  bool _failed = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _failed = false;
    });
    try {
      await ref.read(authControllerProvider.notifier).passwordLogin(_email.text.trim(), _password.text);
      _password.clear();
    } on Exception {
      if (mounted) setState(() => _failed = true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = HmStrings.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(s.t('doctorApp')),
        actions: [
          TextButton(
            onPressed: () => ref.read(localeProvider.notifier).toggle(),
            child: Text(s.t('language')),
          ),
        ],
      ),
      body: HmFormColumn(
        children: [
          Text(s.t('loginTitle'), style: Theme.of(context).textTheme.headlineSmall),
          TextField(
            key: const Key('email'),
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.username],
            decoration: InputDecoration(labelText: s.t('email')),
          ),
          TextField(
            key: const Key('password'),
            controller: _password,
            obscureText: true,
            autofillHints: const [AutofillHints.password],
            decoration: InputDecoration(labelText: s.t('password')),
          ),
          FilledButton(onPressed: _busy ? null : _submit, child: Text(s.t('signIn'))),
          if (_failed) Text(s.t('loginFailed'), style: TextStyle(color: Theme.of(context).colorScheme.error)),
        ],
      ),
    );
  }
}
