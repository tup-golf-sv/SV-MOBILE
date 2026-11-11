package kr.co.tupgolf.svmobile;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
public final class BillingPolicyRegression {
 public static void main(String[] args)throws Exception{
  if(!SubscriptionPlanPolicy.supported(null,false,1,true))throw new AssertionError("ordinary recurring blocked");
  if(SubscriptionPlanPolicy.supported(null,false,1,false))throw new AssertionError("prepaid accepted");
  if(SubscriptionPlanPolicy.supported(null,true,1,true))throw new AssertionError("installment accepted");
  if(SubscriptionPlanPolicy.supported("trial",false,1,true))throw new AssertionError("promotion accepted");
  if(SubscriptionPlanPolicy.supported(null,false,2,true))throw new AssertionError("multi-phase accepted");
  ExecutorService executor=Executors.newSingleThreadExecutor();LifecycleTasks tasks=new LifecycleTasks(executor);
  CountDownLatch first=new CountDownLatch(1),release=new CountDownLatch(1);AtomicInteger called=new AtomicInteger();
  tasks.submit(()->{first.countDown();try{release.await();}catch(InterruptedException ignored){}});
  if(!first.await(1,TimeUnit.SECONDS))throw new AssertionError("work did not start");
  tasks.submit(called::incrementAndGet);tasks.close();tasks.submit(called::incrementAndGet);release.countDown();
  executor.shutdown();if(!executor.awaitTermination(1,TimeUnit.SECONDS))throw new AssertionError("executor alive");
  if(called.get()!=0)throw new AssertionError("late callback ran");
  LifecycleTasks late=new LifecycleTasks(executor);late.submit(()->{throw new AssertionError("shutdown callback ran");});
  System.out.println("PASS: 5 plan cases; queued/late/shutdown lifecycle callbacks blocked");
 }
}
