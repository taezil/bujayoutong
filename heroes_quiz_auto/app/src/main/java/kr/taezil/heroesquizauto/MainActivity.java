package kr.taezil.heroesquizauto;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {
    private static final int REQ_CAPTURE = 5001;
    private MediaProjectionManager projectionManager;
    private SharedPreferences prefs;
    private TextView status;
    private TextView dbCount;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("settings", MODE_PRIVATE);
        projectionManager = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 44);
        }

        setContentView(buildUi());
        refreshInfo();
    }

    private View buildUi() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(18), dp(18), dp(18), dp(28));
        scroll.addView(root);

        TextView title = new TextView(this);
        title.setText("히어로즈테일즈2 길드퀴즈 AUTO");
        title.setTextSize(24);
        title.setTextColor(Color.rgb(88, 58, 26));
        title.setGravity(Gravity.CENTER_HORIZONTAL);
        title.setPadding(0, 0, 0, dp(8));
        root.addView(title);

        TextView desc = new TextView(this);
        desc.setText("게임 왼쪽 위 퀴즈 박스를 OCR로 읽고, 등록된 정답을 찾아 길드 채팅에 자동 입력·전송합니다.\n\n첫 실행은 아래 1→2→3 순서로 설정하세요.");
        desc.setTextSize(16);
        desc.setPadding(0, 0, 0, dp(16));
        root.addView(desc);

        Button access = button("1. 접근성 서비스 켜기");
        access.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        root.addView(access);

        Button imeSettings = button("2. 퀴즈 AUTO 키보드 활성화");
        imeSettings.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)));
        root.addView(imeSettings);

        Button pickIme = button("퀴즈 AUTO 키보드 선택");
        pickIme.setOnClickListener(v -> {
            InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            imm.showInputMethodPicker();
        });
        root.addView(pickIme);

        Switch auto = new Switch(this);
        auto.setText("자동 입력 + 자동 전송");
        auto.setTextSize(17);
        auto.setChecked(prefs.getBoolean("auto_send", true));
        auto.setPadding(dp(4), dp(12), dp(4), dp(12));
        auto.setOnCheckedChangeListener((b, checked) -> prefs.edit().putBoolean("auto_send", checked).apply());
        root.addView(auto);

        Button start = button("3. 퀴즈 감지 시작");
        start.setTextSize(19);
        start.setOnClickListener(v -> startActivityForResult(projectionManager.createScreenCaptureIntent(), REQ_CAPTURE));
        root.addView(start);

        Button stop = button("감지 중지");
        stop.setOnClickListener(v -> {
            stopService(new Intent(this, QuizCaptureService.class));
            Toast.makeText(this, "퀴즈 감지를 중지했습니다.", Toast.LENGTH_SHORT).show();
            refreshInfo();
        });
        root.addView(stop);

        status = new TextView(this);
        status.setTextSize(15);
        status.setPadding(dp(8), dp(15), dp(8), dp(10));
        root.addView(status);

        dbCount = new TextView(this);
        dbCount.setTextSize(15);
        dbCount.setPadding(dp(8), dp(4), dp(8), dp(8));
        root.addView(dbCount);

        TextView addTitle = new TextView(this);
        addTitle.setText("정답 DB 추가");
        addTitle.setTextSize(20);
        addTitle.setPadding(0, dp(22), 0, dp(8));
        root.addView(addTitle);

        EditText q = edit("문제 문장");
        root.addView(q);
        EditText a = edit("정답");
        root.addView(a);

        Button add = button("문제/정답 추가");
        add.setOnClickListener(v -> {
            String qs = q.getText().toString().trim();
            String as = a.getText().toString().trim();
            if (qs.isEmpty() || as.isEmpty()) {
                Toast.makeText(this, "문제와 정답을 입력하세요.", Toast.LENGTH_SHORT).show();
                return;
            }
            new QuizDatabase(this).add(qs, as);
            q.setText(""); a.setText("");
            refreshInfo();
            Toast.makeText(this, "정답 DB에 추가했습니다.", Toast.LENGTH_SHORT).show();
        });
        root.addView(add);

        Button importClip = button("클립보드에서 여러 문제 가져오기");
        importClip.setOnClickListener(v -> {
            ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            if (!cm.hasPrimaryClip()) {
                Toast.makeText(this, "클립보드가 비어 있습니다.", Toast.LENGTH_SHORT).show();
                return;
            }
            ClipData.Item item = cm.getPrimaryClip().getItemAt(0);
            CharSequence text = item.coerceToText(this);
            int n = new QuizDatabase(this).importTsv(text == null ? "" : text.toString());
            refreshInfo();
            Toast.makeText(this, n + "개 가져왔습니다. 형식: 문제|정답", Toast.LENGTH_LONG).show();
        });
        root.addView(importClip);

        TextView tip = new TextView(this);
        tip.setText("사용 팁\n• 길드 채팅창을 열어둔 상태에서 실행하세요.\n• 화면공유 허용 창에서 '전체 화면'을 허용해야 OCR이 됩니다.\n• 미등록 문제는 자동 전송하지 않고 화면에 알려줍니다.\n• 좌표는 제공해준 가로 화면 기준 비율값(입력칸 약 20%/94%, 전송 약 36%/94%)을 사용합니다.");
        tip.setTextSize(14);
        tip.setPadding(dp(8), dp(20), dp(8), dp(8));
        root.addView(tip);

        return scroll;
    }

    private Button button(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.setMargins(0, dp(5), 0, dp(5));
        b.setLayoutParams(lp);
        return b;
    }

    private EditText edit(String hint) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setSingleLine(false);
        e.setMinLines(1);
        e.setMaxLines(3);
        return e;
    }

    private int dp(int x) { return (int) (x * getResources().getDisplayMetrics().density + 0.5f); }

    private void refreshInfo() {
        if (status == null) return;
        String lastQ = prefs.getString("last_question", "-");
        String lastA = prefs.getString("last_answer", "-");
        String state = prefs.getBoolean("running", false) ? "실행 중" : "중지됨";
        status.setText("상태: " + state + "\n마지막 감지: " + lastQ + "\n마지막 정답: " + lastA);
        dbCount.setText("현재 로컬 정답 DB: " + new QuizDatabase(this).size() + "개");
    }

    @Override
    protected void onResume() {
        super.onResume();
        refreshInfo();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_CAPTURE) {
            if (resultCode == RESULT_OK && data != null) {
                Intent svc = new Intent(this, QuizCaptureService.class);
                svc.putExtra("resultCode", resultCode);
                svc.putExtra("resultData", data);
                if (Build.VERSION.SDK_INT >= 26) startForegroundService(svc); else startService(svc);
                Toast.makeText(this, "감지를 시작합니다. 이제 게임으로 돌아가세요.", Toast.LENGTH_LONG).show();
            } else {
                Toast.makeText(this, "화면 캡처 권한이 필요합니다.", Toast.LENGTH_SHORT).show();
            }
        }
    }
}
