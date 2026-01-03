local value = redis.call('GET', KEYS[1])
-- If value is empty, set the value
if not value then
    local result = redis.call('SET', KEYS[1], ARGV[1]) 
    -- Check if ARGV[2] exists and is greater than 0
    local expireTime = tonumber(ARGV[2])
    if expireTime and expireTime > 0 then
        redis.call('EXPIRE', KEYS[1], expireTime)
    end
end
return value