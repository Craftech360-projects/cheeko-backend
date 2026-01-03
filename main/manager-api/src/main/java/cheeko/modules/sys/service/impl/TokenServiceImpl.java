package cheeko.modules.sys.service.impl;

import org.springframework.stereotype.Service;

import lombok.AllArgsConstructor;
import cheeko.modules.security.oauth2.TokenGenerator;
import cheeko.modules.sys.service.TokenService;

@AllArgsConstructor
@Service
public class TokenServiceImpl implements TokenService {

    @Override
    public String createToken(long userId) {
        // Generate a token
        String token = TokenGenerator.generateValue();
        return token;
    }
}
