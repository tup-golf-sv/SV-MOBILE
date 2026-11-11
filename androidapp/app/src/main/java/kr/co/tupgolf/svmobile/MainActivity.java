package kr.co.tupgolf.svmobile;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.*;
import android.provider.MediaStore;
import android.webkit.*;
import android.widget.*;
import androidx.webkit.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

public class MainActivity extends Activity {
    static final String ORIGIN="https://appassets.androidplatform.net";
    private WebView web;
    private PermissionRequest cameraRequest;
    private ValueCallback<Uri[]> chooser;
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private final Map<String,Transfer> transfers=new HashMap<>();
    private ProBilling pro;
    private TextView proStatus;
    static class Transfer {
        File file; OutputStream out; long expected, written; String mode,mime;
    }
    @Override public void onCreate(Bundle b) {
        super.onCreate(b);
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);
        root.setOnApplyWindowInsetsListener((v,insets)->{v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets;});
        LinearLayout toolbar=new LinearLayout(this);
        Button account=new Button(this);account.setText("Pro · 계정 / 복원");account.setOnClickListener(v->pro.show());
        proStatus=new TextView(this);proStatus.setText("무료 기능 사용 가능");toolbar.addView(account);toolbar.addView(proStatus);root.addView(toolbar);
        web=new WebView(this);root.addView(web,new LinearLayout.LayoutParams(-1,0,1));setContentView(root);
        pro=new ProBilling(this,io,s->runOnUiThread(()->proStatus.setText(s)));
        WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);s.setAllowFileAccess(false);s.setAllowContentAccess(false);
        WebViewAssetLoader loader=new WebViewAssetLoader.Builder().addPathHandler("/assets/",new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){return loader.shouldInterceptRequest(r.getUrl());}
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return !r.getUrl().toString().startsWith(ORIGIN+"/assets/");}
            @Override public void onPageFinished(WebView v,String url){if(url.equals(ORIGIN+"/assets/index.html"))try{v.evaluateJavascript(readAsset("native-adapter.js"),null);}catch(Exception e){toast("Android 연결 오류");}}
        });
        if(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web,"SVNative",Collections.singleton(ORIGIN),(v,message,origin,main,reply)->{
                if(!main)return;
                io.execute(()->{JSONObject result=new JSONObject();try{JSONObject m=new JSONObject(message.getData());result.put("id",m.getString("id"));handle(m,result);result.put("ok",true);}catch(Exception ex){try{result.put("ok",false);result.put("error",ex.getMessage()==null?"처리 실패":ex.getMessage());}catch(Exception ignored){}}runOnUiThread(()->reply.postMessage(result.toString()));});
            });
        } else toast("Android System WebView를 업데이트해야 영상 저장을 사용할 수 있습니다.");
        web.setWebChromeClient(new WebChromeClient(){
            @Override public void onPermissionRequest(PermissionRequest r){runOnUiThread(()->{
                if(!ORIGIN.equals(r.getOrigin().toString().replaceAll("/$",""))){r.deny();return;}
                if(cameraRequest!=null)cameraRequest.deny();cameraRequest=r;
                ArrayList<String> needed=new ArrayList<>();
                for(String resource:r.getResources()){
                    String permission=resource.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE)?Manifest.permission.CAMERA:resource.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE)?Manifest.permission.RECORD_AUDIO:null;
                    if(permission!=null&&checkSelfPermission(permission)!=PackageManager.PERMISSION_GRANTED)needed.add(permission);
                }
                if(needed.isEmpty())grantCamera();else requestPermissions(needed.toArray(new String[0]),21);
            });}
            @Override public void onPermissionRequestCanceled(PermissionRequest r){if(cameraRequest==r)cameraRequest=null;}
            @Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> c,FileChooserParams p){if(chooser!=null)chooser.onReceiveValue(null);chooser=c;try{startActivityForResult(p.createIntent(),20);return true;}catch(Exception e){chooser=null;c.onReceiveValue(null);return false;}}
        });
        web.loadUrl(ORIGIN+"/assets/index.html");
    }
    private void grantCamera(){
        if(cameraRequest==null)return;ArrayList<String> allowed=new ArrayList<>();
        for(String r:cameraRequest.getResources())if((r.equals(PermissionRequest.RESOURCE_VIDEO_CAPTURE)&&checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED)||(r.equals(PermissionRequest.RESOURCE_AUDIO_CAPTURE)&&checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED))allowed.add(r);
        if(allowed.isEmpty())cameraRequest.deny();else cameraRequest.grant(allowed.toArray(new String[0]));cameraRequest=null;
    }
    @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] grants){super.onRequestPermissionsResult(code,permissions,grants);if(code==21)grantCamera();}
    private String readAsset(String name)throws Exception{try(InputStream in=getAssets().open(name)){ByteArrayOutputStream bytes=new ByteArrayOutputStream();ProBilling.copy(in,bytes);return bytes.toString("UTF-8");}}
    private void handle(JSONObject m,JSONObject result)throws Exception{
        String id=m.getString("session"),action=m.getString("action");
        if(action.equals("begin")){
            if(!transfers.isEmpty())throw new IOException("다른 저장이 진행 중입니다.");
            Transfer t=new Transfer();t.expected=m.getLong("size");t.mode=m.getString("mode");t.mime=m.getString("mime");
            if(t.expected<=0||t.expected>100L*1024*1024||!Arrays.asList("local","cloud").contains(t.mode)||!Arrays.asList("video/mp4","video/webm").contains(t.mime))throw new IOException("지원하지 않는 영상 크기 또는 형식입니다.");
            if(t.mode.equals("cloud"))pro.requireEntitlement();
            t.file=File.createTempFile("swing-",".tmp",getCacheDir());t.out=new FileOutputStream(t.file);transfers.put(id,t);return;
        }
        Transfer t=transfers.get(id);if(t==null)throw new IOException("저장 세션이 만료되었습니다.");
        if(action.equals("abort")){cleanup(id);return;}
        try{
            if(action.equals("chunk")){
                String data=m.getString("data");if(data.length()>270000)throw new IOException("영상 조각이 너무 큽니다.");
                byte[] bytes=android.util.Base64.decode(data,android.util.Base64.NO_WRAP);
                if(t.written+bytes.length>t.expected)throw new IOException("영상 크기가 일치하지 않습니다.");
                t.out.write(bytes);t.written+=bytes.length;return;
            }
            if(!action.equals("finish")||t.written!=t.expected)throw new IOException("영상 전송이 완료되지 않았습니다.");
            t.out.close();
            if(t.mode.equals("cloud"))pro.upload(t.file,t.mime);else result.put("uri",saveVideo(t.file,t.mime).toString());
            cleanup(id);
        }catch(Exception e){cleanup(id);throw e;}
    }
    Uri saveVideo(File file,String mime)throws Exception{
        ContentValues values=new ContentValues();values.put(MediaStore.Video.Media.DISPLAY_NAME,"TUP_SV_"+System.currentTimeMillis()+(mime.equals("video/mp4")?".mp4":".webm"));
        values.put(MediaStore.Video.Media.MIME_TYPE,mime);values.put(MediaStore.Video.Media.RELATIVE_PATH,"Movies/SV MOBILE");values.put(MediaStore.Video.Media.IS_PENDING,1);
        Uri uri=getContentResolver().insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,values);if(uri==null)throw new IOException("저장 공간을 열 수 없습니다.");
        try{
            try(InputStream in=new FileInputStream(file);OutputStream out=getContentResolver().openOutputStream(uri)){if(out==null)throw new IOException("파일을 열 수 없습니다.");ProBilling.copy(in,out);}
            values.clear();values.put(MediaStore.Video.Media.IS_PENDING,0);getContentResolver().update(uri,values,null,null);return uri;
        }catch(Exception e){getContentResolver().delete(uri,null,null);throw e;}
    }
    private void cleanup(String id){Transfer t=transfers.remove(id);if(t!=null){try{t.out.close();}catch(Exception ignored){}t.file.delete();}}
    void toast(String s){runOnUiThread(()->Toast.makeText(this,s,Toast.LENGTH_LONG).show());}
    @Override protected void onActivityResult(int code,int result,Intent data){super.onActivityResult(code,result,data);if(code==20&&chooser!=null){chooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));chooser=null;}}
    @Override protected void onResume(){super.onResume();if(pro!=null)pro.restore(false);}
    @Override protected void onDestroy(){pro.close();web.destroy();io.execute(()->{for(String id:new ArrayList<>(transfers.keySet()))cleanup(id);});io.shutdown();super.onDestroy();}
    @Override public void onBackPressed(){if(web.canGoBack())web.goBack();else super.onBackPressed();}
}
