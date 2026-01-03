package cheeko.modules.content.dao;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;

import cheeko.modules.content.entity.StoryPlaylistEntity;

/**
 * Story Playlist Data Access Object
 */
@Mapper
public interface StoryPlaylistDao extends BaseMapper<StoryPlaylistEntity> {

    /**
     * Get playlist for a specific device, ordered by position
     *
     * @param deviceId Device ID
     * @return List of playlist entries ordered by position
     */
    List<StoryPlaylistEntity> getPlaylistByDeviceId(@Param("deviceId") String deviceId);

    /**
     * Delete all playlist entries for a device
     *
     * @param deviceId Device ID
     * @return Number of rows deleted
     */
    int deleteByDeviceId(@Param("deviceId") String deviceId);

    /**
     * Batch insert playlist entries
     *
     * @param list List of playlist entries
     * @return Number of rows inserted
     */
    int batchInsert(@Param("list") List<StoryPlaylistEntity> list);

    /**
     * Get max position for a device (for appending)
     *
     * @param deviceId Device ID
     * @return Max position or null if playlist is empty
     */
    Integer getMaxPosition(@Param("deviceId") String deviceId);

    /**
     * Update position for a specific entry
     *
     * @param deviceId Device ID
     * @param contentId Content ID
     * @param position New position
     * @return Number of rows updated
     */
    int updatePosition(@Param("deviceId") String deviceId,
                       @Param("contentId") String contentId,
                       @Param("position") Integer position);

    /**
     * Delete a specific item from playlist
     *
     * @param deviceId Device ID
     * @param contentId Content ID
     * @return Number of rows deleted
     */
    int deleteByDeviceAndContent(@Param("deviceId") String deviceId,
                                  @Param("contentId") String contentId);

    /**
     * Shift positions down after deletion (to fill gaps)
     *
     * @param deviceId Device ID
     * @param startPosition Position to start shifting from
     * @return Number of rows updated
     */
    int shiftPositionsDown(@Param("deviceId") String deviceId,
                           @Param("startPosition") Integer startPosition);

    /**
     * Count playlist items for a device
     *
     * @param deviceId Device ID
     * @return Number of items
     */
    int countByDeviceId(@Param("deviceId") String deviceId);
}
