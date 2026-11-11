// Where a picture's subject is, for a phone's title page (src/components/DetailArt.tsx): the page shows a
// narrow strip of a wide backdrop, and the strip should be on the people in it, not the picture's middle.
// Vision finds them: faces first (a face is what must not be cut), else what draws the eye (attention
// saliency). Called off the main thread (art_focus.rs); nothing is kept.

#import <Foundation/Foundation.h>
#import <Vision/Vision.h>

/// The subject's place across the picture, 0 (left edge) to 1 (right edge), from a base64 JPEG or PNG;
/// -1 when the picture can't be read or nothing stands out in it.
double polar_art_focus(const char *base64) {
  @autoreleasepool {
    if (!base64) return -1;
    NSString *text = [NSString stringWithUTF8String:base64];
    NSData *data = text ? [[NSData alloc] initWithBase64EncodedString:text options:NSDataBase64DecodingIgnoreUnknownCharacters] : nil;
    if (data.length == 0) return -1;

    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithData:data options:@{}];
    VNDetectFaceRectanglesRequest *faces = [[VNDetectFaceRectanglesRequest alloc] init];
    VNGenerateAttentionBasedSaliencyImageRequest *saliency = [[VNGenerateAttentionBasedSaliencyImageRequest alloc] init];
    NSError *error = nil;
    if (![handler performRequests:@[ faces, saliency ] error:&error]) return -1;

    // The middle of the faces, each counted by its size: a face up close outweighs one in the crowd.
    double total = 0, at = 0;
    for (VNFaceObservation *face in faces.results) {
      CGRect box = face.boundingBox;
      double weight = box.size.width * box.size.height;
      total += weight;
      at += weight * CGRectGetMidX(box);
    }
    if (total > 0) return at / total;

    VNSaliencyImageObservation *seen = saliency.results.firstObject;
    for (VNRectangleObservation *object in seen.salientObjects) {
      CGRect box = object.boundingBox;
      double weight = box.size.width * box.size.height * object.confidence;
      total += weight;
      at += weight * CGRectGetMidX(box);
    }
    return total > 0 ? at / total : -1;
  }
}
