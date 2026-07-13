import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/api_client.dart';
import 'features/auth/auth_page.dart';
import 'features/home/shell_page.dart';

void main() => runApp(const ProviderScope(child: SchedulerApp()));
class SchedulerApp extends ConsumerWidget {
  const SchedulerApp({super.key});
  @override Widget build(BuildContext context, WidgetRef ref) {
    final loggedIn=ref.watch(authProvider).token!=null;
    return MaterialApp(debugShowCheckedModeBanner:false,title:'KMU Smart Scheduler',themeMode:ThemeMode.system,
      theme:ThemeData(colorScheme:ColorScheme.fromSeed(seedColor:const Color(0xff2357d9)),useMaterial3:true),
      darkTheme:ThemeData(colorScheme:ColorScheme.fromSeed(seedColor:const Color(0xff8eabff),brightness:Brightness.dark),useMaterial3:true),
      home:loggedIn?const ShellPage():const AuthPage());
  }
}

