package kr.co.tupgolf.svmobile;

import android.app.AlertDialog;
import android.content.*;
import android.net.Uri;
import android.text.InputType;
import android.widget.*;
import com.android.billingclient.api.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.function.Consumer;

final class ProBilling implements PurchasesUpdatedListener {
    private final MainActivity app;
    private final ExecutorService io;
    private final Consumer<String> status;
    private final BillingClient billing;
    private final android.content.SharedPreferences prefs;
    private volatile String idToken="", uid="";
    private volatile boolean closed;
    ProBilling(MainActivity app,ExecutorService io,Consumer<String> status){
        this.app=app;this.io=io;this.status=status;prefs=app.getSharedPreferences("account",0);
        billing=BillingClient.newBuilder(app).setListener(this).enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build()).enableAutoServiceReconnection().build();
        billing.startConnection(new BillingClientStateListener(){
            public void onBillingSetupFinished(BillingResult result){if(result.getResponseCode()==BillingClient.BillingResponseCode.OK)restore(false);}
            public void onBillingServiceDisconnected(){status.accept("무료 · Play 연결 대기");}
        });
    }
    private void configured()throws IOException{
        if(!BuildConfig.API_BASE.startsWith("https://")||BuildConfig.FIREBASE_API_KEY.isEmpty())throw new IOException("Pro 서버와 Play 상품 연결 전 개발 빌드입니다. 무료 기능을 사용할 수 있습니다.");
    }
    void show(){
        String[] options={"로그인", "회원가입", "Pro 구독 구매", "구매 복원", "클라우드 영상 목록", "Google Play 구독 관리", "로그아웃"};
        new AlertDialog.Builder(app).setTitle("SV MOBILE Pro · 클라우드 영상 보관").setItems(options,(d,n)->{
            if(n==0||n==1)login(n==1);if(n==2)buy();if(n==3)restore(true);if(n==4)listVideos();
            if(n==5)app.startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://play.google.com/store/account/subscriptions?sku="+BuildConfig.PRO_PRODUCT+"&package="+app.getPackageName())));
            if(n==6){prefs.edit().clear().apply();idToken="";uid="";status.accept("무료 · 로그아웃");}
        }).show();
    }
    private void login(boolean signup){
        try{configured();}catch(Exception e){app.toast(e.getMessage());return;}
        LinearLayout form=new LinearLayout(app);form.setOrientation(LinearLayout.VERTICAL);
        EditText email=new EditText(app);email.setHint("이메일");email.setInputType(InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS|InputType.TYPE_CLASS_TEXT);
        EditText password=new EditText(app);password.setHint("비밀번호 (8자 이상)");password.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);form.addView(email);form.addView(password);
        new AlertDialog.Builder(app).setTitle(signup?"회원가입":"로그인").setView(form).setNegativeButton("취소",null).setPositiveButton("확인",(d,n)->{
            String address=email.getText().toString().trim(),secret=password.getText().toString();
            io.execute(()->{try{
                if(secret.length()<8)throw new IOException("비밀번호는 8자 이상이어야 합니다.");
                JSONObject body=new JSONObject().put("email",address).put("password",secret).put("returnSecureToken",true);
                JSONObject result=json("https://identitytoolkit.googleapis.com/v1/accounts:"+(signup?"signUp":"signInWithPassword")+"?key="+BuildConfig.FIREBASE_API_KEY,"POST",body.toString(),null);
                idToken=result.getString("idToken");uid=result.getString("localId");
                prefs.edit().putString("refresh",result.getString("refreshToken")).apply();
                status.accept("로그인 완료 · 구매 확인 중");app.runOnUiThread(()->restore(true));
            }catch(Exception e){app.toast(e.getMessage());}});
        }).show();
    }
    private synchronized void authenticate()throws Exception{
        configured();String refresh=prefs.getString("refresh","");if(refresh.isEmpty())throw new IOException("Pro 계정에 먼저 로그인하세요.");
        // Refresh for each protected operation; no client-side boolean grants entitlement.
        JSONObject result=form("https://securetoken.googleapis.com/v1/token?key="+BuildConfig.FIREBASE_API_KEY,"grant_type=refresh_token&refresh_token="+URLEncoder.encode(refresh,"UTF-8"));
        idToken=result.getString("id_token");uid=result.getString("user_id");prefs.edit().putString("refresh",result.getString("refresh_token")).apply();
    }
    JSONObject requireEntitlement()throws Exception{
        authenticate();JSONObject result=api("/v1/entitlement","GET",null);
        if(!result.optBoolean("pro"))throw new IOException("활성 Pro 구독이 필요합니다.");return result;
    }
    private String accountHash()throws Exception{
        byte[] digest=MessageDigest.getInstance("SHA-256").digest(uid.getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte b:digest)out.append(String.format("%02x",b&255));return out.toString();
    }
    void buy(){
        io.execute(()->{try{authenticate();api("/v1/config","GET",null);String hash=accountHash();app.runOnUiThread(()->queryAndBuy(hash));}catch(Exception e){app.toast(e.getMessage());}});
    }
    private void queryAndBuy(String hash){
        if(!billing.isReady()){app.toast("Google Play 연결을 확인한 후 다시 시도하세요.");return;}
        QueryProductDetailsParams.Product product=QueryProductDetailsParams.Product.newBuilder().setProductId(BuildConfig.PRO_PRODUCT).setProductType(BillingClient.ProductType.SUBS).build();
        billing.queryProductDetailsAsync(QueryProductDetailsParams.newBuilder().setProductList(Collections.singletonList(product)).build(),(r,details)->{
            if(r.getResponseCode()!=BillingClient.BillingResponseCode.OK||details.getProductDetailsList().isEmpty()){app.toast("Play 상품을 불러오지 못했습니다: "+r.getResponseCode());return;}
            ProductDetails p=details.getProductDetailsList().get(0);
            List<ProductDetails.SubscriptionOfferDetails> offers=p.getSubscriptionOfferDetails();
            if(offers==null||offers.isEmpty()){app.toast("구매 가능한 구독이 없습니다.");return;}
            // Base plan only: do not silently choose trials or promotional offers.
            ProductDetails.SubscriptionOfferDetails selected=null;for(var offer:offers)if(offer.getOfferId()==null){selected=offer;break;}
            if(selected==null){app.toast("기본 구독 요금제를 사용할 수 없습니다.");return;}
            final String offerToken=selected.getOfferToken();StringBuilder terms=new StringBuilder();
            for(var phase:selected.getPricingPhases().getPricingPhaseList())terms.append(phase.getFormattedPrice()).append(" / ").append(phase.getBillingPeriod()).append("\n");
            app.runOnUiThread(()->new AlertDialog.Builder(app).setTitle(p.getName()).setMessage("클라우드 영상 보관\n"+terms+"자동 갱신 구독입니다. Google Play에서 해지할 수 있습니다. 기존 무료 촬영·분석·저장은 유지됩니다.").setNegativeButton("취소",null).setPositiveButton("Google Play에서 구매",(d,n)->{
                BillingFlowParams.ProductDetailsParams item=BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(p).setOfferToken(offerToken).build();
                BillingResult result=billing.launchBillingFlow(app,BillingFlowParams.newBuilder().setObfuscatedAccountId(hash).setProductDetailsParamsList(Collections.singletonList(item)).build());
                if(result.getResponseCode()!=BillingClient.BillingResponseCode.OK)app.toast("구매 화면 오류: "+result.getResponseCode());
            }).show());
        });
    }
    @Override public void onPurchasesUpdated(BillingResult r,List<Purchase> purchases){
        if(r.getResponseCode()==BillingClient.BillingResponseCode.OK&&purchases!=null)verify(purchases,true);
        else if(r.getResponseCode()==BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED)restore(true);
        else if(r.getResponseCode()==BillingClient.BillingResponseCode.USER_CANCELED)status.accept("구매 취소 · 무료 기능 사용 가능");
        else app.toast("구매 확인 오류: "+r.getResponseCode());
    }
    void restore(boolean visible){
        if(closed||!billing.isReady())return;
        if(prefs.getString("refresh","").isEmpty()){if(visible)app.toast("먼저 Pro 계정에 로그인하세요.");return;}
        billing.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build(),(r,purchases)->{
            if(r.getResponseCode()==BillingClient.BillingResponseCode.OK)verify(purchases,visible);else if(visible)app.toast("구매 복원 오류: "+r.getResponseCode());
        });
    }
    private void verify(List<Purchase> purchases,boolean visible){
        io.execute(()->{try{
            authenticate();boolean pending=false;
            for(Purchase p:purchases){
                if(!p.getProducts().contains(BuildConfig.PRO_PRODUCT))continue;
                if(p.getPurchaseState()==Purchase.PurchaseState.PENDING){pending=true;continue;}
                if(p.getPurchaseState()==Purchase.PurchaseState.PURCHASED)api("/v1/purchases/verify","POST",new JSONObject().put("purchaseToken",p.getPurchaseToken()).toString());
            }
            JSONObject entitlement=api("/v1/entitlement","GET",null);
            status.accept(entitlement.optBoolean("pro")?"Pro · 서버 확인 완료":pending?"결제 대기 · 무료":"무료 · 활성 구독 없음");
            if(visible)app.toast(entitlement.optBoolean("pro")?"Pro 구매/복원 확인 완료":"활성 구독이 없습니다. 결제 대기 상태는 완료 후 적용됩니다.");
        }catch(Exception e){status.accept("무료 · Pro 확인 필요");if(visible)app.toast(e.getMessage());}});
    }
    void upload(File file,String mime)throws Exception{
        requireEntitlement();HttpURLConnection c=open(BuildConfig.API_BASE+"/v1/videos","POST",idToken);c.setRequestProperty("Content-Type",mime);c.setDoOutput(true);c.setFixedLengthStreamingMode(file.length());
        try{try(OutputStream out=c.getOutputStream();InputStream in=new FileInputStream(file)){copy(in,out);}response(c);}finally{c.disconnect();}
    }
    private void listVideos(){io.execute(()->{try{
        requireEntitlement();JSONArray videos=api("/v1/videos","GET",null).getJSONArray("videos");String[] names=new String[videos.length()];for(int i=0;i<names.length;i++)names[i]=videos.getJSONObject(i).getString("createdAt");
        app.runOnUiThread(()->new AlertDialog.Builder(app).setTitle("클라우드 영상 · 선택하면 휴대폰 저장").setItems(names,(d,n)->io.execute(()->{try{requireEntitlement();JSONObject item=videos.getJSONObject(n);File f=File.createTempFile("cloud-",".tmp",app.getCacheDir());try{
            HttpURLConnection c=open(BuildConfig.API_BASE+"/v1/videos/"+item.getString("id"),"GET",idToken);try{if(c.getResponseCode()!=200)throw new IOException("영상을 가져오지 못했습니다.");try(InputStream in=c.getInputStream();OutputStream out=new FileOutputStream(f)){copy(in,out);}}finally{c.disconnect();}
            app.saveVideo(f,item.getString("mime"));app.toast("휴대폰에 저장했습니다.");
        }finally{f.delete();}}catch(Exception e){app.toast(e.getMessage());}})).setNegativeButton("닫기",null).show());
    }catch(Exception e){app.toast(e.getMessage());}});}
    private JSONObject api(String path,String method,String body)throws Exception{return json(BuildConfig.API_BASE+path,method,body,idToken);}
    static void copy(InputStream in,OutputStream out)throws IOException{byte[] b=new byte[32768];for(int n;(n=in.read(b))!=-1;)out.write(b,0,n);}
    private static HttpURLConnection open(String url,String method,String token)throws Exception{
        if(!url.startsWith("https://"))throw new IOException("보안 서버 주소가 필요합니다.");HttpURLConnection c=(HttpURLConnection)new URL(url).openConnection();c.setConnectTimeout(15000);c.setReadTimeout(45000);c.setInstanceFollowRedirects(false);c.setRequestMethod(method);if(token!=null)c.setRequestProperty("Authorization","Bearer "+token);return c;
    }
    private static JSONObject json(String url,String method,String body,String token)throws Exception{
        HttpURLConnection c=open(url,method,token);try{if(body!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(OutputStream out=c.getOutputStream()){out.write(body.getBytes(StandardCharsets.UTF_8));}}return response(c);}finally{c.disconnect();}
    }
    private static JSONObject form(String url,String body)throws Exception{
        HttpURLConnection c=open(url,"POST",null);try{c.setDoOutput(true);c.setRequestProperty("Content-Type","application/x-www-form-urlencoded");try(OutputStream out=c.getOutputStream()){out.write(body.getBytes(StandardCharsets.UTF_8));}return response(c);}finally{c.disconnect();}
    }
    private static JSONObject response(HttpURLConnection c)throws Exception{
        int code=c.getResponseCode();InputStream stream=code>=400?c.getErrorStream():c.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream();if(stream!=null)try(InputStream in=stream){copy(in,bytes);}JSONObject result=bytes.size()==0?new JSONObject():new JSONObject(bytes.toString("UTF-8"));
        if(code<200||code>=300)throw new IOException("서버 확인 실패 ("+code+"): "+result.optString("detail","로그인 및 구독 상태를 확인하세요."));return result;
    }
    void close(){closed=true;billing.endConnection();}
}
