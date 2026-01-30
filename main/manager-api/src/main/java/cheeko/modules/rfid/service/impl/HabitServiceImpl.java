package cheeko.modules.rfid.service.impl;

import java.util.ArrayList;
import java.util.List;

import org.springframework.stereotype.Service;

import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import cheeko.modules.rfid.dto.ContentDownloadDTO;
import cheeko.modules.rfid.dto.ContentItemDTO;
import cheeko.modules.rfid.dto.HabitDownloadDTO;
import cheeko.modules.rfid.dto.HabitStepDTO;
import cheeko.modules.rfid.service.HabitService;
import cheeko.modules.rfid.service.RfidContentPackService;

/**
 * Habit Service Implementation
 * @deprecated Delegates to RfidContentPackService for unified content handling
 */
@Slf4j
@AllArgsConstructor
@Service
@Deprecated
public class HabitServiceImpl implements HabitService {

    private final RfidContentPackService rfidContentPackService;

    @Override
    @Deprecated
    public HabitDownloadDTO getDownloadManifest(String rfidUid, String currentVersion, String currentHash) {
        // Delegate to unified service
        ContentDownloadDTO unified = rfidContentPackService.getContentDownloadManifest(rfidUid);
        if (unified == null) {
            return null;
        }

        // Only return if it's actually a habit
        if (!"habit".equals(unified.getContentType())) {
            log.info("Content for RFID {} is not a habit (type={})", rfidUid, unified.getContentType());
            return null;
        }

        // Convert to legacy HabitDownloadDTO
        HabitDownloadDTO dto = new HabitDownloadDTO();
        dto.setRfidUid(unified.getRfidUid());
        dto.setContentType("habit");
        dto.setHabitCode(unified.getPackCode());
        dto.setHabitName(unified.getPackName());
        dto.setVersion(unified.getVersion());
        dto.setContentHash(unified.getContentHash());
        dto.setTotalSteps(unified.getTotalItems());

        // Convert items to steps
        List<HabitStepDTO> steps = new ArrayList<>();
        if (unified.getItems() != null) {
            for (ContentItemDTO item : unified.getItems()) {
                HabitStepDTO step = new HabitStepDTO();
                step.setStepNumber(item.getItemNumber());
                step.setTitle(item.getTitle());
                step.setInstructionText(item.getDescription());

                if (item.getAudio() != null) {
                    HabitStepDTO.AudioInfo audio = new HabitStepDTO.AudioInfo();
                    audio.setUrl(item.getAudio().getUrl());
                    audio.setSizeBytes(item.getAudio().getSizeBytes());
                    audio.setDurationMs(item.getAudio().getDurationMs());
                    step.setAudio(audio);
                }

                if (item.getImages() != null) {
                    List<HabitStepDTO.ImageInfo> images = new ArrayList<>();
                    for (ContentItemDTO.ImageInfo img : item.getImages()) {
                        HabitStepDTO.ImageInfo image = new HabitStepDTO.ImageInfo();
                        image.setUrl(img.getUrl());
                        image.setSizeBytes(img.getSizeBytes());
                        image.setSequence(img.getSequence());
                        images.add(image);
                    }
                    step.setImages(images);
                }

                steps.add(step);
            }
        }
        dto.setSteps(steps);

        return dto;
    }
}
