package cheeko.modules.timbre.service.impl;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;

import cn.hutool.core.collection.CollectionUtil;
import lombok.AllArgsConstructor;
import cheeko.common.constant.Constant;
import cheeko.common.page.PageData;
import cheeko.common.redis.RedisKeys;
import cheeko.common.redis.RedisUtils;
import cheeko.common.service.impl.BaseServiceImpl;
import cheeko.common.utils.ConvertUtils;
import cheeko.modules.model.dto.VoiceDTO;
import cheeko.modules.timbre.dao.TimbreDao;
import cheeko.modules.timbre.dto.TimbreDataDTO;
import cheeko.modules.timbre.dto.TimbrePageDTO;
import cheeko.modules.timbre.entity.TimbreEntity;
import cheeko.modules.timbre.service.TimbreService;
import cheeko.modules.timbre.vo.TimbreDetailsVO;

/**
 * Timbres Service Layers Implementation
 * 
 * @author zjy
 * @since 2025-3-21
 */
@AllArgsConstructor
@Service
public class TimbreServiceImpl extends BaseServiceImpl<TimbreDao, TimbreEntity> implements TimbreService {

    private final TimbreDao timbreDao;
    private final RedisUtils redisUtils;

    @Override
    public PageData<TimbreDetailsVO> page(TimbrePageDTO dto) {
        Map<String, Object> params = new HashMap<String, Object>();
        params.put(Constant.PAGE, dto.getPage());
        params.put(Constant.LIMIT, dto.getLimit());
        IPage<TimbreEntity> page = baseDao.selectPage(
                getPage(params, null, true),
                // Define query conditions
                new QueryWrapper<TimbreEntity>()
                        // Must query by TTS ID
                        .eq("tts_model_id", dto.getTtsModelId())
                        // If timbre name provided, fuzzy match by timbre name
                        .like(StringUtils.isNotBlank(dto.getName()), "name", dto.getName()));

        return getPageData(page, TimbreDetailsVO.class);
    }

    @Override
    public TimbreDetailsVO get(String timbreId) {
        if (StringUtils.isBlank(timbreId)) {
            return null;
        }

        // FirstfromRedisGetCache
        String key = RedisKeys.getTimbreDetailsKey(timbreId);
        TimbreDetailsVO cachedDetails = (TimbreDetailsVO) redisUtils.get(key);
        if (cachedDetails != null) {
            return cachedDetails;
        }

        // If not in cache, get from database
        TimbreEntity entity = baseDao.selectById(timbreId);
        if (entity == null) {
            return null;
        }

        // ConvertAsVOObject
        TimbreDetailsVO details = ConvertUtils.sourceToTarget(entity, TimbreDetailsVO.class);

        // Store in Redis cache
        if (details != null) {
            redisUtils.set(key, details);
        }

        return details;
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void save(TimbreDataDTO dto) {
        isTtsModelId(dto.getTtsModelId());
        TimbreEntity timbreEntity = ConvertUtils.sourceToTarget(dto, TimbreEntity.class);
        baseDao.insert(timbreEntity);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void update(String timbreId, TimbreDataDTO dto) {
        isTtsModelId(dto.getTtsModelId());
        TimbreEntity timbreEntity = ConvertUtils.sourceToTarget(dto, TimbreEntity.class);
        timbreEntity.setId(timbreId);
        baseDao.updateById(timbreEntity);
        // DeleteCache
        redisUtils.delete(RedisKeys.getTimbreDetailsKey(timbreId));
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void delete(String[] ids) {
        baseDao.deleteBatchIds(Arrays.asList(ids));
    }

    @Override
    public List<VoiceDTO> getVoiceNames(String ttsModelId, String voiceName) {
        QueryWrapper<TimbreEntity> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("tts_model_id", StringUtils.isBlank(ttsModelId) ? "" : ttsModelId);
        if (StringUtils.isNotBlank(voiceName)) {
            queryWrapper.like("name", voiceName);
        }
        List<TimbreEntity> timbreEntities = timbreDao.selectList(queryWrapper);
        if (CollectionUtil.isEmpty(timbreEntities)) {
            return null;
        }

        return ConvertUtils.sourceToTarget(timbreEntities, VoiceDTO.class);
    }

    /**
     * HandleIsNotttsModels id
     */
    private void isTtsModelId(String ttsModelId) {
        // Wait for Model Configuration to write the validation method
    }

    @Override
    public String getTimbreNameById(String id) {
        if (StringUtils.isBlank(id)) {
            return null;
        }

        String cachedName = (String) redisUtils.get(RedisKeys.getTimbreNameById(id));

        if (StringUtils.isNotBlank(cachedName)) {
            return cachedName;
        }

        TimbreEntity entity = timbreDao.selectById(id);
        if (entity != null) {
            String name = entity.getName();
            if (StringUtils.isNotBlank(name)) {
                redisUtils.set(RedisKeys.getTimbreNameById(id), name);
            }
            return name;
        }

        return null;
    }
}