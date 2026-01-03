package cheeko.common.utils;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.Date;

/**
 * Date handling utility
 * Copyright (c) RenRen Open Source All rights reserved.
 * Website: https://www.renren.io
 */
public class DateUtils {
    /**
     * Time format (yyyy-MM-dd)
     */
    public final static String DATE_PATTERN = "yyyy-MM-dd";
    /**
     * Time format (yyyy-MM-dd HH:mm:ss)
     */
    public final static String DATE_TIME_PATTERN = "yyyy-MM-dd HH:mm:ss";
    public final static String DATE_TIME_MILLIS_PATTERN = "yyyy-MM-dd HH:mm:ss.SSS";


    /**
     * Date format to: yyyy-MM-dd
     *
     * @param date Date
     * @return Returns date in yyyy-MM-dd format
     */
    public static String format(Date date) {
        return format(date, DATE_PATTERN);
    }

    /**
     * Date format to: yyyy-MM-dd
     *
     * @param date    Date
     * @param pattern Format, such as: DateUtils.DATE_TIME_PATTERN
     * @return Returns date in yyyy-MM-dd format
     */
    public static String format(Date date, String pattern) {
        if (date != null) {
            SimpleDateFormat df = new SimpleDateFormat(pattern);
            return df.format(date);
        }
        return null;
    }

    /**
     * Date parsing
     *
     * @param date    Date
     * @param pattern Format, such as: DateUtils.DATE_TIME_PATTERN
     * @return Returns Date
     */
    public static Date parse(String date, String pattern) {
        try {
            return new SimpleDateFormat(pattern).parse(date);
        } catch (ParseException e) {
            e.printStackTrace();
        }
        return null;
    }


    public static String getDateTimeNow() {
        return getDateTimeNow(DATE_TIME_PATTERN);
    }

    public static String getDateTimeNow(String pattern) {
        return format(new Date(), pattern);
    }

    public static String millsToSecond(long mills) {
        return String.format("%.3f", mills / 1000.0);
    }

    /**
     * Get short time string: return "just now" if within 10 seconds, "X seconds ago", "X hours ago", return year-month-day-time if over a week
     * @param date
     * @return
     */
    public static String getShortTime(Date date) {
        if (date == null) {
            return null;
        }
        // Convert Date to Instant
        LocalDateTime localDateTime = date.toInstant()
                // Get system default time zone
                .atZone(ZoneId.systemDefault())
                // Convert to LocalDateTime
                .toLocalDateTime();
        // Current time
        LocalDateTime now = LocalDateTime.now();
        // Time difference, unit is seconds
        long secondsBetween = ChronoUnit.SECONDS.between(localDateTime, now);

        if (secondsBetween <= 10) {
            return "Just now";
        } else if (secondsBetween < 60) {
            return secondsBetween + " seconds ago";
        } else if (secondsBetween < 60 * 60) {
            return secondsBetween / 60 + " minutes ago";
        } else if (secondsBetween < 86400) {
            return secondsBetween / 3600 + " hours ago";
        } else if (secondsBetween < 604800) {
            return secondsBetween / 86400 + " days ago";
        } else {
            // Over a week, display full date time
            return format(date,DATE_TIME_PATTERN);
        }
    }
}
