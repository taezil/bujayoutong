package kr.taezil.heroesquizauto;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.os.Parcelable;
import android.util.DisplayMetrics;
import android.view.WindowManager;
import android.widget.Toast;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions;

import java.nio.ByteBuffer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class QuizCaptureService extends Service {
    private static final String CHANNEL = "quiz_auto";
    private static final int NOTIF_ID = 2401;
    private static final long FRAME_INTERVAL_MS = 380;

    private final Handler main = new Handler(Looper.getMainLooper());
    private HandlerThread workerThread;
    private Handler worker;
    private MediaProjection projection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private TextRecognizer recognizer;
    private QuizDatabase database;
    private SharedPreferences prefs;

    private int width;
    private int height;
    private int density;
    private volatile boolean ocrBusy = false;
    private long lastFrameAt = 0;
    private String lastAnsweredNumber = "";
    private String lastAnsweredFingerprint = "";
    private String lastUnknownFingerprint = "";
    private long lastUnknownToastAt = 0;

    @Override
    public void onCreate() {
        super.onCreate();
        prefs = getSharedPreferences("settings", MODE_PRIVATE);
        database = new QuizDatabase(this);
        recognizer = TextRecognition.getClient(new KoreanTextRecognizerOptions.Builder().build());
        createNotificationChannel();
        startForeground(NOTIF_ID, notification("대기 중 · 화면에서 퀴즈를 찾고 있습니다."));
        workerThread = new HandlerThread("quiz-capture");
        workerThread.start();
        worker = new Handler(workerThread.getLooper());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        int resultCode = intent.getIntExtra("resultCode", 0);
        Intent resultData;
        if (Build.VERSION.SDK_INT >= 33) {
            resultData = intent.getParcelableExtra("resultData", Intent.class);
        } else {
            Parcelable p = intent.getParcelableExtra("resultData");
            resultData = (Intent) p;
        }
        if (resultCode == 0 || resultData == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (projection == null) startProjection(resultCode, resultData);
        prefs.edit().putBoolean("running", true).apply();
        return START_STICKY;
    }

    private void startProjection(int resultCode, Intent resultData) {
        WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        DisplayMetrics dm = new DisplayMetrics();
        if (Build.VERSION.SDK_INT >= 30) {
            width = wm.getCurrentWindowMetrics().getBounds().width();
            height = wm.getCurrentWindowMetrics().getBounds().height();
            density = getResources().getDisplayMetrics().densityDpi;
        } else {
            wm.getDefaultDisplay().getRealMetrics(dm);
            width = dm.widthPixels;
            height = dm.heightPixels;
            density = dm.densityDpi;
        }

        MediaProjectionManager mpm = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
        projection = mpm.getMediaProjection(resultCode, resultData);
        projection.registerCallback(new MediaProjection.Callback() {
            @Override public void onStop() { stopSelf(); }
        }, main);

        imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2);
        virtualDisplay = projection.createVirtualDisplay(
                "HeroesQuizAuto",
                width, height, density,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.getSurface(), null, worker);
        imageReader.setOnImageAvailableListener(this::onFrame, worker);
    }

    private void onFrame(ImageReader reader) {
        long now = System.currentTimeMillis();
        if (now - lastFrameAt < FRAME_INTERVAL_MS || ocrBusy) {
            Image drop = reader.acquireLatestImage();
            if (drop != null) drop.close();
            return;
        }
        lastFrameAt = now;
        Image image = reader.acquireLatestImage();
        if (image == null) return;
        Bitmap full = null;
        Bitmap crop = null;
        try {
            Image.Plane plane = image.getPlanes()[0];
            ByteBuffer buffer = plane.getBuffer();
            int pixelStride = plane.getPixelStride();
            int rowStride = plane.getRowStride();
            int rowPadding = rowStride - pixelStride * width;
            Bitmap padded = Bitmap.createBitmap(width + rowPadding / pixelStride, height, Bitmap.Config.ARGB_8888);
            padded.copyPixelsFromBuffer(buffer);
            full = Bitmap.createBitmap(padded, 0, 0, width, height);
            if (padded != full) padded.recycle();

            int left = Math.max(0, (int) (width * 0.025f));
            int top = 0;
            int right = Math.min(width, (int) (width * 0.43f));
            int bottom = Math.min(height, (int) (height * 0.34f));
            crop = Bitmap.createBitmap(full, left, top, right - left, bottom - top);
        } catch (Throwable t) {
            if (full != null) full.recycle();
            image.close();
            return;
        }
        image.close();
        if (full != null) full.recycle();

        final Bitmap ocrBitmap = crop;
        ocrBusy = true;
        recognizer.process(InputImage.fromBitmap(ocrBitmap, 0))
                .addOnSuccessListener(this::handleOcr)
                .addOnFailureListener(e -> {})
                .addOnCompleteListener(task -> {
                    ocrBusy = false;
                    if (!ocrBitmap.isRecycled()) ocrBitmap.recycle();
                });
    }

    private void handleOcr(Text result) {
        String raw = result == null ? "" : result.getText();
        Parsed parsed = parseQuestion(raw);
        if (parsed == null || parsed.question.length() < 5) return;

        QuizDatabase.Match match = database.findBest(parsed.question);
        String fingerprint = QuizDatabase.normalize(parsed.question);
        prefs.edit().putString("last_question", parsed.question).apply();

        if (match == null || match.score < 0.60) {
            if (!fingerprint.equals(lastUnknownFingerprint) || System.currentTimeMillis() - lastUnknownToastAt > 8000) {
                lastUnknownFingerprint = fingerprint;
                lastUnknownToastAt = System.currentTimeMillis();
                prefs.edit().putString("last_answer", "미등록").apply();
                updateNotification("미등록 문제: " + shortText(parsed.question, 42));
                main.post(() -> Toast.makeText(this, "미등록 문제 · DB에 정답을 추가하세요", Toast.LENGTH_SHORT).show());
            }
            return;
        }

        boolean already = (!parsed.number.isEmpty() && parsed.number.equals(lastAnsweredNumber))
                || (!fingerprint.isEmpty() && fingerprint.equals(lastAnsweredFingerprint));
        if (already) return;

        lastAnsweredNumber = parsed.number;
        lastAnsweredFingerprint = fingerprint;
        prefs.edit().putString("last_answer", match.answer).apply();
        updateNotification("정답: " + match.answer + "  (일치 " + (int)(match.score * 100) + "%)");
        main.post(() -> Toast.makeText(this, "정답: " + match.answer, Toast.LENGTH_SHORT).show());

        if (prefs.getBoolean("auto_send", true)) {
            autoSend(match.answer);
        } else {
            copyAnswer(match.answer);
        }
    }

    private void autoSend(String answer) {
        QuizAccessibilityService acc = QuizAccessibilityService.get();
        if (acc == null) {
            copyAnswer(answer);
            main.post(() -> Toast.makeText(this, "접근성 서비스가 꺼져 있어 정답만 복사했습니다.", Toast.LENGTH_LONG).show());
            return;
        }

        float inputX = width * prefs.getFloat("input_x", 0.20f);
        float inputY = height * prefs.getFloat("input_y", 0.94f);
        acc.tap(inputX, inputY);
        attemptImeCommit(answer, 0);
    }

    private void attemptImeCommit(String answer, int attempt) {
        main.postDelayed(() -> {
            QuizAccessibilityService acc = QuizAccessibilityService.get();
            if (acc == null) {
                copyAnswer(answer);
                return;
            }

            boolean typed = QuizImeService.commitAnswer(answer);
            if (!typed && attempt < 5) {
                attemptImeCommit(answer, attempt + 1);
                return;
            }
            if (!typed) typed = acc.setFocusedText(answer);
            if (!typed) {
                copyAnswer(answer);
                Toast.makeText(this, "자동입력 실패 · 정답을 클립보드에 복사했습니다.", Toast.LENGTH_LONG).show();
                return;
            }

            main.postDelayed(() -> {
                QuizAccessibilityService a = QuizAccessibilityService.get();
                if (a != null) {
                    float sendX = width * prefs.getFloat("send_x", 0.36f);
                    float sendY = height * prefs.getFloat("send_y", 0.94f);
                    a.tap(sendX, sendY);
                }
            }, 480);
        }, attempt == 0 ? 260 : 140);
    }

    private void copyAnswer(String answer) {
        ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        cm.setPrimaryClip(ClipData.newPlainText("quiz_answer", answer));
    }

    private static final class Parsed {
        final String number;
        final String question;
        Parsed(String number, String question) { this.number = number; this.question = question; }
    }

    private Parsed parseQuestion(String raw) {
        if (raw == null) return null;
        String flat = raw.replace('\n', ' ').replace('\r', ' ').replaceAll("\\s+", " ").trim();
        Matcher m = Pattern.compile("(\\d{1,3})\\s*번째\\s*문제", Pattern.CASE_INSENSITIVE).matcher(flat);
        if (!m.find()) return null;
        String number = m.group(1);
        String q = flat.substring(m.end()).trim();

        q = q.replaceFirst("^\\s*\\(?\\s*현재\\s*정답\\s*[:：]?\\s*\\d+\\s*/\\s*\\d+\\s*\\)?", "").trim();
        q = q.replaceFirst("^\\s*[)】>》:：·•◇◆★☆-]+", "").trim();

        Matcher timer = Pattern.compile("\\d{1,3}\\s*초\\s*후\\s*다음\\s*문제\\s*시작", Pattern.CASE_INSENSITIVE).matcher(q);
        if (timer.find()) q = q.substring(0, timer.start()).trim();

        q = q.replaceAll("\\s+", " ").trim();
        if (q.length() > 140) q = q.substring(0, 140);
        return new Parsed(number == null ? "" : number, q);
    }

    private String shortText(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max) + "…";
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "길드퀴즈 자동 감지", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("화면의 길드퀴즈를 OCR로 감지합니다.");
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(ch);
        }
    }

    private Notification notification(String text) {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        return b.setContentTitle("히테2 퀴즈 AUTO")
                .setContentText(text)
                .setSmallIcon(android.R.drawable.ic_menu_search)
                .setOngoing(true)
                .build();
    }

    private void updateNotification(String text) {
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(NOTIF_ID, notification(text));
    }

    @Override
    public void onDestroy() {
        prefs.edit().putBoolean("running", false).apply();
        if (imageReader != null) imageReader.close();
        if (virtualDisplay != null) virtualDisplay.release();
        if (projection != null) projection.stop();
        if (recognizer != null) recognizer.close();
        if (workerThread != null) workerThread.quitSafely();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
