# Ubuntu Docker 개발 환경

Ubuntu 24.04 기준. Docker Engine, Buildx, Compose 플러그인을 설치한다.
공식 안내: https://docs.docker.com/engine/install/ubuntu/

## 시스템 설치

아래 명령은 호스트 터미널에서 실행한다. sudo 비밀번호는 터미널에 입력한다.
기존 Docker/containerd 설치가 있는 환경은 공식 안내의 충돌 패키지 확인부터 수행한다.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

DOCKER_UBUNTU_CODENAME=$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
DOCKER_ARCH=$(dpkg --print-architecture)
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${DOCKER_UBUNTU_CODENAME}
Components: stable
Architectures: ${DOCKER_ARCH}
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker run --rm hello-world
docker compose version
```

systemd가 없는 컨테이너/제한 실행 환경에서는 호스트에 설치해야 한다.
이 문서의 Docker 명령은 sudo로 실행하며, docker 그룹 추가는 필수가 아니다.

## 프로젝트 실행

프로젝트 루트 `.env`에 API 키와 Supabase 접속 정보를 설정한다.
Compose가 백엔드에만 주입하므로 프론트엔드에 키를 복사하지 않는다.
`.env` 파일은 이미지 빌드 컨텍스트에서도 제외한다.

먼저 기존 로컬 uvicorn/Next.js 서버를 종료해 8000/3000 포트를 비운다.

```bash
# 프로젝트 루트에서 설정 검사 (환경변수 값은 출력하지 않음)
sudo docker compose -f docker-compose.yml -f docker-compose.dev.yml config --quiet

# 최초 빌드 및 실행 (두 서비스의 헬스체크 완료까지 대기)
sudo docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build --wait --wait-timeout 180

# 상태 및 로그
sudo docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
sudo docker compose -f docker-compose.yml -f docker-compose.dev.yml logs --tail=50

# 백엔드 및 프론트 프록시 확인
curl --fail http://localhost:8000/health
curl --fail http://localhost:3000/health

# 종료 (볼륨은 유지)
sudo docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

- 프론트엔드: http://localhost:3000
- API 문서: http://localhost:8000/docs
- 개발 서버는 소스 변경을 감지한다.
- 프론트 프록시는 Docker 서비스명 `server:8000`으로 연결한다.
- 의존성 변경 시 이미지를 다시 빌드한다. 프론트 패키지가 바뀌면
  `up -d --build --renew-anon-volumes`로 node_modules 볼륨도 갱신한다.
- `.env` 변경 시 `up -d --force-recreate server`로 백엔드 컨테이너를 재생성한다.
- 백엔드는 이미지 빌드 때 설치한 가상환경을 직접 실행한다. 개발 모드에서는
  `/app/backend`만 감시하며, 프론트의 `.next` 변경은 감시하지 않는다.
- 프론트 헬스체크는 `/` 응답을 검사한다. `/health`는 백엔드 프록시 확인용이다.

## 운영 이미지 확인

개발 컨테이너를 먼저 `down`한 뒤 실행한다. 운영 모드는 소스 마운트 없이
Next.js standalone 서버와 FastAPI를 실행한다.

```bash
sudo docker compose config --quiet
sudo docker compose up -d --build --wait --wait-timeout 180
sudo docker compose ps
curl --fail http://localhost:3000/health
sudo docker compose down
```

`BACKEND_API_URL`과 `NEXT_PUBLIC_UPLOAD_BASE_URL`은 frontend 이미지의 빌드 인자로
전달한다. 값을 바꾸면 client 이미지를 다시 빌드해야 한다.
