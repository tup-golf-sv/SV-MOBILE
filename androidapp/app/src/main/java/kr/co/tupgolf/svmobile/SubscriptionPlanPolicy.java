package kr.co.tupgolf.svmobile;

/** The MVP checkout supports ordinary auto-renewing base plans only. */
final class SubscriptionPlanPolicy {
    static boolean supported(String offerId, boolean installment, int phaseCount, boolean infiniteRecurring) {
        return offerId == null && !installment && phaseCount == 1 && infiniteRecurring;
    }
}
