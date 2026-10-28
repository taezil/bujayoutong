; 부자유통 발주 알림센터 설치 프로그램 (Inno Setup 6)
; 관리자 권한 없이 현재 사용자에게 설치합니다 (%LOCALAPPDATA%\Programs\BujaOrderAlert)
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define AppName "부자유통 발주 알림센터"
#define AppExe "BujaOrderAlert.exe"

[Setup]
AppId={{6F1B2E7C-3A5D-4C8B-9E21-B0A7D5C4F118}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=부자유통
DefaultDirName={localappdata}\Programs\BujaOrderAlert
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist-installer
OutputBaseFilename=BujaOrderAlert-Setup-{#AppVersion}
SetupIconFile=..\buja_desk\assets\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
MinVersion=10.0

#if FileExists(CompilerPath + "Languages\Korean.isl")
[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
#endif

[Tasks]
Name: "autostart"; Description: "Windows 시작 시 자동 실행 (권장)"; GroupDescription: "추가 설정:"
Name: "desktopicon"; Description: "바탕화면에 바로가기 만들기"; GroupDescription: "추가 설정:"

[Files]
Source: "..\dist\BujaOrderAlert\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "BujaOrderAlert"; ValueData: """{app}\{#AppExe}"" --minimized"; Tasks: autostart; Flags: uninsdeletevalue

[Run]
Filename: "{app}\{#AppExe}"; Description: "지금 실행"; Flags: nowait postinstall skipifsilent
; 자동 업데이트(조용히 설치)가 끝나면 프로그램을 다시 켬
Filename: "{app}\{#AppExe}"; Parameters: "--minimized --updated"; Flags: nowait runasoriginaluser; Check: WizardSilent

[UninstallRun]
Filename: "{cmd}"; Parameters: "/C taskkill /IM {#AppExe} /F"; Flags: runhidden; RunOnceId: "KillApp"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"
