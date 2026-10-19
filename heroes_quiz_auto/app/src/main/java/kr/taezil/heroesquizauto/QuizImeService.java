package kr.taezil.heroesquizauto;

import android.graphics.Color;
import android.inputmethodservice.InputMethodService;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.InputConnection;
import android.widget.TextView;

public class QuizImeService extends InputMethodService {
    private static volatile QuizImeService instance;

    public static boolean commitAnswer(String answer) {
        QuizImeService s = instance;
        if (s == null) return false;
        InputConnection ic = s.getCurrentInputConnection();
        if (ic == null) return false;
        boolean ok = ic.commitText(answer, 1);
        s.requestHideSelf(0);
        return ok;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override
    public View onCreateInputView() {
        TextView v = new TextView(this);
        v.setText("히테2 퀴즈 AUTO 키보드 · 자동입력 대기");
        v.setTextColor(Color.WHITE);
        v.setBackgroundColor(Color.rgb(40, 40, 40));
        v.setTextSize(16);
        v.setGravity(Gravity.CENTER);
        v.setPadding(12, 18, 12, 18);
        return v;
    }
}
